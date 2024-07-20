# Important Deployment Information

## Deployment Guidelines

1. **Do not deploy the stack twice on the same account under the same region**

   - This will result in a naming collision.

2. **Do not change resource names after deployment**

   - Changing names will delete the old resources and create new ones with the new names.

3. **Stack deletion behavior**
   - If you delete the stack, the DB and S3 bucket will not be deleted.
   - A RETAIN policy is defined to prevent data loss.

## Deployment Process

To deploy the stack:

1. Navigate to the jet-trails folder
2. Run the deployment script:
   ./deploy.sh

This command will:

- Install Python libraries
- Deploy everything from scratch

3. Note the output values:

- EC2 bastion host instance ID
- DB host

## Connecting to the Database

Use port forwarding to connect to the DB:

```
aws ssm start-session \
 --target <ec2_id> \
 --document-name AWS-StartPortForwardingSessionToRemoteHost \
 --parameters '{"portNumber":["5432"],"localPortNumber":["7000"],"host":["<dbhost>"]}'

```

After this you will have the result like
Port 7000 opened for sessionId ...
Waiting for connections...

Use PG Admin or other prefferable postresql app to connect where
host: 127.0.0.1
pass, username, dbidentificator you should get from the aws secrets manager

To check all available users:

```sql
SELECT usename FROM pg_catalog.pg_user;

Expected result:

"postgresadmin"
"maintenance"
"analytics_user1"
"analytics_user2"
```

The password for the current users you can get in aws console under the aws ssm params.

## Tips

1. To save costs, you can stop the EC2 bastion machine when not in use.
   Use STOP, not TERMINATE.

2. Do not change any resource names if the stack is already deployed.
   Changing names will delete old resources and recreate them with new names.
