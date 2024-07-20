#!/bin/bash

# Navigate to the directory containing requirements.txt for lambdaCreateSetupDB
rootfolder=$(pwd)

cd "$rootfolder/lib/jet-trail-infra/lambdas/lambdaCreateSetupDB"

# Print the current working directory for debugging purposes
pwd

# Install the Python requirements for lambdaCreateSetupDB
echo "Installing Python requirements for lambdaCreateSetupDB..."
pip install -r requirements.txt --target .

# Navigate to the directory containing requirements.txt for lambdaUploadCSV

cd ../lamdaUploadCSV

# Print the current working directory for debugging purposes
pwd

# Install the Python requirements for lambdaUploadCSV
echo "Installing Python requirements for lambdaUploadCSV..."
pip install -r requirements.txt --target .

# Navigate back to the root directory


# Deploy the CDK stack
echo "Deploying CDK stack..."
# cdk deploy

cd "$rootfolder"

cdk deploy --require-approval=never
