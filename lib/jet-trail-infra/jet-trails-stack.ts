import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as path from "path";
import * as cr from "aws-cdk-lib/custom-resources";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as eventTargets from "aws-cdk-lib/aws-events-targets";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Database } from "@aws-cdk/aws-glue-alpha";
import { Construct } from "constructs";
import {
  aws_s3 as s3,
  aws_s3_notifications as s3n,
  aws_sqs as sqs,
  aws_events as events,
  aws_glue as glue,
} from "aws-cdk-lib";

interface ExtendedStackProps extends cdk.StackProps {
  config: {
    postgresDatabaseName: string,
    postgresTableName: string,
    glueTableName: string,
    lambdaUploadFunctionName: string
    email: string
  }
}

export class JetTrailsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ExtendedStackProps) {
    super(scope, id, props);

    const accountId = cdk.Stack.of(this).account;
    const stackName = cdk.Stack.of(this).stackName;
    const stack = cdk.Stack.of(this);

    const config = props.config

    // Name of the default DB
    const postgresDatabaseName = config.postgresDatabaseName

    // Name of the main table
    const postgresTableName = config.postgresTableName

    // Name of the glue table
    const glueTableName = config.postgresDatabaseName

    // Create VPC with public, private and isolated subnet.
    const vpc = new ec2.Vpc(this, "VPCMain", {
      maxAzs: 2,
      vpcName: "vpc-jet-trail",
      subnetConfiguration: [
        {
          name: "PublicSubnet",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          name: "PrivateSubnet",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          name: "IsolatedSubnet",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // S3 bucket for storing aws glue script.
    const scriptBucket = new s3.Bucket(this, "ScriptBucket", {
      removalPolicy: cdk.RemovalPolicy.RETAIN, 
      autoDeleteObjects: true,
    });

    // Upload the script to the bucket
    new s3deploy.BucketDeployment(this, "DeployScript", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "scripts"))],
      destinationBucket: scriptBucket,
      destinationKeyPrefix: "scripts",
    });

    // Create a new Role for Glue
    const glueRole = new iam.Role(this, "GlueRole", {
      roleName: `${id}-GlueRole-${stackName}`,
      description: "Role for Glue services to access services",
      assumedBy: new iam.ServicePrincipal("glue.amazonaws.com"),
    });

    // Attach policies to Glue role
    glueRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "s3:*",
          "glue:*",
          "iam:*",
          "logs:*",
          "cloudwatch:*",
          "sqs:*",
          "ec2:*",
          "cloudtrail:*",
        ],
        resources: ["*"],
      }),
    );

    // Create S3 Bucket for Glue
    const glueS3Bucket = new s3.Bucket(this, "GlueJetTrailBucket", {
      versioned: true,
      bucketName: `jettrails${accountId}1`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      eventBridgeEnabled: true,
    });

    glueS3Bucket.grantReadWrite(glueRole);

    // Create SQS Queue for Glue
    const glueQueue = new sqs.Queue(this, "GlueQueue");

    // Allow Glue to receive messages from the queue
    glueQueue.grantConsumeMessages(glueRole);

    // Add Event Notification
    glueS3Bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SqsDestination(glueQueue),
    );

    const glueDBName = `glue-db-${stackName}`;
    const glueDatabase = new Database(this, "GlueDatabase", {
      databaseName: glueDBName.toLocaleLowerCase(),
    });

    const glueCrawler = new glue.CfnCrawler(this, "GlueCrawler", {
      name: `glue_crawler-${stackName}`,
      role: glueRole.roleArn,
      databaseName: glueDatabase.databaseName,
      targets: {
        s3Targets: [
          {
            path: `s3://${glueS3Bucket.bucketName}/`,
            eventQueueArn: glueQueue.queueArn,
          },
        ],
      },
      recrawlPolicy: {
        recrawlBehavior: "CRAWL_EVENT_MODE",
      },
      schemaChangePolicy: {
        updateBehavior: "LOG",
        deleteBehavior: "LOG",
      },
    });

    // Create AWS Glue workflow
    const glueWorkflow = new glue.CfnWorkflow(this, "GlueWorkflow", {
      name: `Glue-Workflow-${stackName}`,
      description: "Workflow to process the jettrail data.",
    });

    // Create Glue Crawler Trigger
    const glueCrawlerTrigger = new glue.CfnTrigger(this, "GlueCrawlerTrigger", {
      name: `glue_crawler_trigger-${stackName}`,
      actions: [
        {
          crawlerName: glueCrawler.name,
          notificationProperty: { notifyDelayAfter: 3 },
          timeout: 3,
        },
      ],
      type: "EVENT",
      workflowName: glueWorkflow.name,
    });

    glueCrawlerTrigger.node.addDependency(glueS3Bucket);
    glueCrawlerTrigger.node.addDependency(glueWorkflow, glueCrawler);

    // Create EventBridge Role
    const ruleRole = new iam.Role(this, "EventBridgeRole", {
      roleName: `${id}-EventBridgeRole-${stackName}`, // Dynamic role name
      description: "Role for EventBridge to trigger Glue workflows.",
      assumedBy: new iam.ServicePrincipal("events.amazonaws.com"),
    });

    ruleRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["events:*", "glue:*"],
        resources: ["*"],
      }),
    );

    // Create EventBridge Rule for nonifying when new doc arrives to s3
    new events.CfnRule(this, "RuleS3Glue", {
      name: `rule_s3_glue-${stackName}`,
      roleArn: ruleRole.roleArn,
      targets: [
        {
          arn: `arn:aws:glue:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:workflow/${glueWorkflow.name}`,
          roleArn: ruleRole.roleArn,
          id: cdk.Aws.ACCOUNT_ID,
        },
      ],
      eventPattern: {
        "detail-type": ["Object Created"],
        detail: {
          bucket: { name: [glueS3Bucket.bucketName] },
        },
        source: ["aws.s3"],
      },
    });

    // Create an elastic IP for NAT GW
    let eip = new ec2.CfnEIP(this, `EIPInPublicSubnet`, {});
    cdk.Tags.of(eip).add("Name", `EIPInPublicSubnet`);

    // NAT GATEWAY
    let natGateway = new ec2.CfnNatGateway(this, `NatGW`, {
      subnetId: vpc.publicSubnets[0].subnetId,
      allocationId: eip.attrAllocationId,
    });

    // Security Group for bastion host
    const bastionSecurityGroup = new ec2.SecurityGroup(
      this,
      `BastionSecurityGroup`,
      {
        vpc,
        allowAllOutbound: true,
        securityGroupName: "BastionSecurityGroup",
      },
    );

    // Bastion host for accessing DB.
    const bastionHost = new ec2.BastionHostLinux(this, "BastionHost", {
      vpc,
      subnetSelection: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: bastionSecurityGroup,
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: ec2.BlockDeviceVolume.ebs(10, {
            encrypted: true,
          }),
        },
      ],
    });

    // SG for RDS to allow inbound traffic within VPC CIDR.
    const rdsSecurityGroup = new ec2.SecurityGroup(this, "SecurityGroupRDS", {
      vpc,
    });
    rdsSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
    );
    rdsSecurityGroup.addIngressRule(
      bastionSecurityGroup,
      ec2.Port.tcp(5432),
      "Allow PostgreSQL access from Bastion Host",
    );

    // DB instance
    const dbInstance = new rds.DatabaseInstance(this, "DBIstances", {
      vpc,
      instanceIdentifier: "db-jettrails",
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_13_14,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE3,
        ec2.InstanceSize.MICRO,
      ),

      credentials: rds.Credentials.fromGeneratedSecret("postgresadmin"),
      multiAz: false,
      allocatedStorage: 100,
      maxAllocatedStorage: 200,
      allowMajorVersionUpgrade: false,
      autoMinorVersionUpgrade: true,
      backupRetention: cdk.Duration.days(0),
      deleteAutomatedBackups: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: true, 
      securityGroups: [rdsSecurityGroup],
      databaseName: postgresDatabaseName,
      publiclyAccessible: true,
    });

    // Create SecurityGroup for Glue connection
    const securityGroupConnection = new ec2.SecurityGroup(
      this,
      "SecurityGroupConnection",
      {
        allowAllOutbound: true,
        vpc,
      },
    );

    rdsSecurityGroup.connections.allowFrom(
      securityGroupConnection.connections,
      ec2.Port.allTcp(),
    );

    securityGroupConnection.connections.allowInternally(ec2.Port.allTcp());

    // AWS glue connection.
    const glueConnection = new glue.CfnConnection(this, "GlueConnection", {
      catalogId: cdk.Aws.ACCOUNT_ID,
      connectionInput: {
        name: "jettrails-glue-connection",
        connectionProperties: {
          JDBC_CONNECTION_URL: `jdbc:postgresql://${dbInstance.dbInstanceEndpointAddress}:${dbInstance.dbInstanceEndpointPort}/${postgresDatabaseName}`,
          USERNAME: dbInstance.secret
            ?.secretValueFromJson("username")
            .unsafeUnwrap()
            .toString(),
          PASSWORD: dbInstance.secret
            ?.secretValueFromJson("password")
            .unsafeUnwrap()
            .toString(),
          JDBC_ENFORCE_SSL: "false",
        },
        connectionType: "JDBC",
        matchCriteria: ["*"],
        physicalConnectionRequirements: {
          availabilityZone: vpc.availabilityZones[0],
          securityGroupIdList: [securityGroupConnection.securityGroupId],
          subnetId: vpc.privateSubnets[0].subnetId,
        },
      },
    });

    const glueJob = new glue.CfnJob(this, "MyCfnJob", {
      name: `glue-job-jettrails`,
      command: {
        name: "glueetl",
        scriptLocation: `s3://${scriptBucket.bucketName}/scripts/glue_job.py`,
      },
      connections: {
        connections: [glueConnection.ref],
      },
      glueVersion: "4.0",
      role: glueRole.roleArn,
      defaultArguments: {
        "--CONNECTION_NAME": glueConnection.ref,
        "--DB_TABLE_NAME": postgresTableName,
        "--DATABASE_NAME": postgresDatabaseName,
        "--GLUE_DB_NAME": glueDBName,
        "--GLUE_TABLE_NAME": glueS3Bucket.bucketName,
      },
    });

    // Create Glue Job Trigger
    new glue.CfnTrigger(this, "GlueJobTrigger", {
      name: "glue_job_trigger",
      actions: [
        {
          jobName: glueJob.name,
          notificationProperty: { notifyDelayAfter: 3 },
          timeout: 3,
        },
      ],
      type: "CONDITIONAL",
      startOnCreation: true,
      workflowName: glueWorkflow.name,
      predicate: {
        conditions: [
          {
            crawlerName: glueCrawler.name,
            logicalOperator: "EQUALS",
            crawlState: "SUCCEEDED",
          },
        ],
      },
    }).node.addDependency(glueWorkflow, glueCrawler, glueJob);

    // Security group for Lambda
    const lambdaSecurityGroup = new ec2.SecurityGroup(
      this,
      "LambdaSecurityGroup",
      {
        vpc: vpc,
      },
    );

    // Create role for Lambda functions
    const lambdaRole = new iam.Role(this, "LambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    lambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaVPCAccessExecutionRole",
      ),
    );

    // Policy to access Secrets Manager
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["secretsmanager:GetSecretValue"],
        resources: ["*"],
      }),
    );

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ssm:PutParameter", "ssm:GetParameter"],
        resources: ["*"],
      }),
    );

    // Lambda function to initialize DB
    // In this lambda we create all users and tables with triggers.
    const lambdaCreateSetupDB = new lambda.Function(
      this,
      "LambdaCreateSetupDB",
      {
        functionName: `create-setup-db-${stackName}`,
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "index.lambda_handler",
        code: lambda.Code.fromAsset(
          path.join(__dirname, "lambdas/lambdaCreateSetupDB"),
        ),
        vpc,
        role: lambdaRole,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        environment: {
          SECRET_ARN: dbInstance.secret!.secretArn,
          DATABASE: postgresDatabaseName,
          TABLE: postgresTableName,
        },
        timeout: cdk.Duration.minutes(2),
      },
    );

    // Create role for Lambda functions
    const lambdaRoleUploadCSV = new iam.Role(this, "LambdaRoleUploadCSV", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    lambdaRoleUploadCSV.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaVPCAccessExecutionRole",
      ),
    );

    // Policy to access Secrets Manager
    lambdaRoleUploadCSV.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:PutObject"],
        resources: ["*"],
      }),
    );

    const onFailureTopic = new cdk.aws_sns.Topic(this, "OnFailureTopic");
    onFailureTopic.addSubscription(
      new subscriptions.EmailSubscription(config.email),
    );

    // Lambda function for uploading csv
    const lambdaUploadCSV = new lambda.Function(this, "LambdaUploadCSV", {
      functionName: config.postgresTableName,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "index.lambda_handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "lambdas/lamdaUploadCSV"),
      ),
      vpc,
      role: lambdaRoleUploadCSV,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      timeout: cdk.Duration.minutes(2),
      retryAttempts: 2,
      environment: {
        BUCKET_NAME: glueS3Bucket.bucketName,
        REGION: stack.region,
        GLUE_TABLE_NAME: glueTableName,
      },
    });

    const errorsMetric = lambdaUploadCSV.metricErrors({
      period: cdk.Duration.minutes(1),
    });

    new cloudwatch.Alarm(this, `LambdaErrorsAlarm`, {
      metric: errorsMetric,
      threshold: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      evaluationPeriods: 1,
      alarmDescription: `Alarm if the SUM of Errors is greater than or equal to the threshold (1) for 1 evaluation period`,
    }).addAlarmAction(new actions.SnsAction(onFailureTopic));

    onFailureTopic.grantPublish(lambdaRoleUploadCSV);

    rdsSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      "Allow PostgreSQL access from Lambda",
    );

    const esRequestProvider = new cr.Provider(this, `EsRequestProvider`, {
      onEventHandler: lambdaCreateSetupDB,
    });

    new cdk.CustomResource(this, "CustomResource", {
      serviceToken: esRequestProvider.serviceToken,
    });

    // Run every day at 00:00
    const rule = new Rule(this, "Rule", {
      schedule: Schedule.cron({
        hour: "0", // Run at 00:00 UTC (adjust as needed)
        minute: "0", // Run at the start of the hour
      }),
    });

    rule.addTarget(new LambdaFunction(lambdaUploadCSV));

    // Notification in case of a AWS glue failure.
    const glueJobFailureRule = new events.Rule(this, "GlueJobFailureRule", {
      eventPattern: {
        source: ["aws.glue"],
        detailType: ["Glue Job State Change"],
        detail: {
          state: ["FAILED"],
        },
      },
    });

    glueJobFailureRule.addTarget(
      new eventTargets.SnsTopic(onFailureTopic, {
        message: events.RuleTargetInput.fromText(
          `WARNING: Glue job ${events.EventField.fromPath("$.detail.jobName")} has failed in account ${events.EventField.fromPath(
            "$.account",
          )} in region ${events.EventField.fromPath(
            "$.region",
          )}. The job with ID ${events.EventField.fromPath(
            "$.detail.jobRunId",
          )} for ${events.EventField.fromPath(
            "$.detail.jobName",
          )} in Glue catalog ${events.EventField.fromPath(
            "$.detail.glueCatalogId",
          )} has failed with status ${events.EventField.fromPath(
            "$.detail.state",
          )}. Reason: ${events.EventField.fromPath(
            "$.detail.errorMessage",
          )}. Please investigate further.`,
        ),
      }),
    );

    new cdk.CfnOutput(this, 'DBEndpoint', {
      value: dbInstance.instanceEndpoint.hostname,
      description: 'Host name of a DB'
  });

    new cdk.CfnOutput(this, 'BastionHostID', {
      value: bastionHost.instanceId,
      description: 'ID of a bastion host'
  });
  }
}
