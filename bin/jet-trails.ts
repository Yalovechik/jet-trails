#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { JetTrailsStack } from '../lib/jet-trail-infra/jet-trails-stack';

const configuration = {
  postgresDatabaseName: "jettraildb",
  postgresTableName: "jettrailtable",
  glueTableName: "gluejettrails",
  lambdaUploadFunctionName: "upload-csv-lambda",
  email: "Yalovechik2012@gmail.com"
}


const configDefault = {
  env: {
      account: "817007669088",
      // region: "eu-north-1", //change region if nedeed
      region: "us-east-1",
  },
  config: configuration,
};

const app = new cdk.App();
new JetTrailsStack(app, 'JetTrailsStack', configDefault);