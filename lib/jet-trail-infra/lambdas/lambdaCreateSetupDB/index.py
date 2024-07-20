import os
import json
import boto3
import pg8000
import string
import random
from botocore.exceptions import ClientError

secretArn = os.environ.get('SECRET_ARN')
region = os.environ.get('REGION')

def get_db_credentials(secret_name):
    region_name = region
    
    # Create a Secrets Manager client
    session = boto3.session.Session()
    client = session.client(
        service_name='secretsmanager',
        region_name=region_name
    )
    
    try:
        get_secret_value_response = client.get_secret_value(
            SecretId=secret_name
        )
    except ClientError as e:
        raise e
    
    # Decrypts secret using the associated KMS key.
    secret = get_secret_value_response['SecretString']
    
    # Parse the secret
    return json.loads(secret)

def generate_random_password(length=16):
    characters = string.ascii_letters + string.digits + string.punctuation
    password = ''.join(random.choice(characters) for i in range(length))
    return password

def store_password_in_ssm(parameter_name, password):
    ssm_client = boto3.client('ssm')
    ssm_client.put_parameter(
        Name=parameter_name,
        Value=password,
        Type='SecureString',
        Overwrite=True
    )

def escape_sql_string(value):
    return value.replace("'", "''")

def lambda_handler(event=None, context=None):
    responseData = {}
    try:
        # Use default values for testing if no event is provided
        if event is None:
            event = {
                'RequestType': 'Create'
            }

        if event['RequestType'] == 'Create':
            secret_name = secretArn 

            # Get the database credentials from Secrets Manager
            credentials = get_db_credentials(secret_name)

            db_host = credentials['host']
            db_name = credentials['dbname']
            db_user = credentials['username']
            db_password = credentials['password']
            db_port = credentials.get('port', 5432)

            # Generate random passwords
            maintenance_password = generate_random_password()
            analytics_password1 = generate_random_password()
            analytics_password2 = generate_random_password()

            # Store passwords in SSM
            store_password_in_ssm('/db/maintenance_password', maintenance_password)
            store_password_in_ssm('/db/analytics_password1', analytics_password1)
            store_password_in_ssm('/db/analytics_password2', analytics_password2)

            # Escape passwords for SQL
            maintenance_password_escaped = escape_sql_string(maintenance_password)
            analytics_password1_escaped = escape_sql_string(analytics_password1)
            analytics_password2_escaped = escape_sql_string(analytics_password2)

            # SQL command to create the table
            create_table_query = '''
            CREATE TABLE IF NOT EXISTS jettrailtable (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                registration VARCHAR(255),
                manufacturer VARCHAR(255),
                type_aircraft VARCHAR(255),
                serial_number VARCHAR(255),
                home_airfield VARCHAR(255),
                owner_lessor VARCHAR(255),
                owner_address VARCHAR(255),
                beneficiary VARCHAR(255),
                beneficiary_address VARCHAR(255),
                creditor VARCHAR(255),
                creditor_address VARCHAR(255),
                seizing_entity VARCHAR(255), 
                seizing_entity_address VARCHAR(255)
            );
            '''

            # SQL command to create the second table
            create_unique_table_query = '''
            CREATE TABLE IF NOT EXISTS unique_jettrailtable (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMP,
                registration VARCHAR(255),
                manufacturer VARCHAR(255),
                type_aircraft VARCHAR(255),
                serial_number VARCHAR(255),
                home_airfield VARCHAR(255),
                owner_lessor VARCHAR(255),
                owner_address VARCHAR(255),
                beneficiary VARCHAR(255),
                beneficiary_address VARCHAR(255),
                creditor VARCHAR(255),
                creditor_address VARCHAR(255),
                seizing_entity VARCHAR(255), 
                seizing_entity_address VARCHAR(255),
                UNIQUE (registration, manufacturer, type_aircraft, serial_number, home_airfield, owner_lessor, owner_address, beneficiary, beneficiary_address, creditor, creditor_address, seizing_entity, seizing_entity_address)
            );
            '''

            # SQL command to create the trigger function
            create_trigger_function_query = '''
            CREATE OR REPLACE FUNCTION insert_if_unique()
            RETURNS TRIGGER AS $$
            BEGIN
                -- Insert the new record into unique_jettrailtable if it's unique
                INSERT INTO unique_jettrailtable (
                    timestamp, registration, manufacturer, type_aircraft, 
                    serial_number, home_airfield, owner_lessor, owner_address, 
                    beneficiary, beneficiary_address, creditor, creditor_address, 
                    seizing_entity, seizing_entity_address
                ) VALUES (
                    NEW.timestamp, NEW.registration, NEW.manufacturer, NEW.type_aircraft, 
                    NEW.serial_number, NEW.home_airfield, NEW.owner_lessor, NEW.owner_address, 
                    NEW.beneficiary, NEW.beneficiary_address, NEW.creditor, NEW.creditor_address, 
                    NEW.seizing_entity, NEW.seizing_entity_address
                )
                ON CONFLICT DO NOTHING;

                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
            '''

            # SQL command to create the trigger
            create_trigger_query = '''
            CREATE TRIGGER before_insert_insert_if_unique
            BEFORE INSERT ON jettrailtable
            FOR EACH ROW EXECUTE FUNCTION insert_if_unique();
            '''

            # SQL commands to create the maintenance account and two analytics users
            create_maintenance_account_query = '''
            CREATE USER maintenance WITH PASSWORD '{}';
            GRANT ALL PRIVILEGES ON DATABASE {} TO maintenance;
            '''.format(maintenance_password_escaped, db_name)

            create_analytics_user1_query = '''
            CREATE USER analytics_user1 WITH PASSWORD '{}';
            GRANT SELECT ON ALL TABLES IN SCHEMA public TO analytics_user1;
            '''.format(analytics_password1_escaped)

            create_analytics_user2_query = '''
            CREATE USER analytics_user2 WITH PASSWORD '{}';
            GRANT SELECT ON ALL TABLES IN SCHEMA public TO analytics_user2;
            '''.format(analytics_password2_escaped)

            try:
                # Establish a connection to the database
                connection = pg8000.connect(
                    host=db_host,
                    database=db_name,
                    user=db_user,
                    password=db_password,
                    port=db_port
                )
                
                cursor = connection.cursor()
                
                # Execute the create table commands
                cursor.execute(create_table_query)
                cursor.execute(create_unique_table_query)
                
                # Execute the create trigger function and trigger commands
                cursor.execute(create_trigger_function_query)
                cursor.execute(create_trigger_query)
                
                # Execute the create user commands
                cursor.execute(create_maintenance_account_query)
                cursor.execute(create_analytics_user1_query)
                cursor.execute(create_analytics_user2_query)
                
                # Commit the transaction
                connection.commit()
                
                # Close the cursor and connection
                cursor.close()
                connection.close()
                
                responseData = {'Status': 'Database, tables, trigger, and user accounts created successfully'}
                print(json.dumps(responseData))
            except Exception as e:
                responseData = {'Status': 'Failed to create database, tables, trigger, and user accounts', 'Error': str(e)}
                print(json.dumps(responseData))
                
        else:
            # For Update and Delete events, we do nothing
            responseData = {'Status': 'No action required for this event type'}
            print(json.dumps(responseData))
    
    except Exception as e:
        responseData = {'Status': 'Failed to process event', 'Error': str(e)}
        print(json.dumps(responseData))
