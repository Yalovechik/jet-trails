IMPORTANT:

1. Please, do not deploy stack twice on the same account under the same region (as it will be naming collesion)
2. Please do not change the name of the resources when it is alredy deployed (it will delete the old one and create a new one with the new name)
3. If you delete the stack, the DB and S3 bucket will not be deleted, cause I defined the policy to RETAIN (to prevent data loss).

4. To deploy the stack you need to go to jet-trails folder
   ./deploy.sh
   This command install python libr, and deploy everything from scratch. At the end there will be an output - instance id (id of an ec2 bastion host) - db host

Please use this value to do a port forwarding to connect to DB.

aws ssm start-session \
 --target <ec2_id> \
 --document-name AWS-StartPortForwardingSessionToRemoteHost \
 --parameters '{"portNumber":["5432"],"localPortNumber":["7000"],"host":["<dbhost>"]}'

After this you will have the result like
Port 7000 opened for sessionId ...
Waiting for connections...

Use PG Admin or other prefferable postresql app to connect where
host: 127.0.0.1
pass, username, dbidentificator you should get from the aws secrets manager

To check all available users:
SELECT usename FROM pg_catalog.pg_user;

Result Should be like this : - "postgresadmin" - "maintenance" - "analytics_user1" - "analytics_user2"

The password for the current users you can get in aws console under the aws ssm params.

TIPS:

1. You can stop EC2 bastion maching when you are not connecting to DB to safe money. Please use only STOP, not TERMINATE.
2. Do not change any name on the stack if the stack already deployed, since it will delete the old one and recreate the same with the new name.
