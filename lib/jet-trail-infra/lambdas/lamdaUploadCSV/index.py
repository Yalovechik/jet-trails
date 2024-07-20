import json
import boto3
import requests
from datetime import datetime
from bs4 import BeautifulSoup
from urllib.parse import urljoin
import os

region = os.environ.get('REGION')
s3BucketName = os.environ.get('BUCKET_NAME')
glueTableName = os.environ.get('GLUE_TABLE_NAME')

def lambda_handler(event, context):
    # Define the S3 bucket name
    s3_bucket_name = s3BucketName
    s3_region = region
    
    # Get the current date and time
    now = datetime.now()
    year = now.strftime("%Y")
    month = now.strftime("%b")
    day = now.strftime("%d")
    
    # Construct the S3 object key with the desired path format
    s3_object_key = f'{glueTableName}/year={year}/month={month}/day={day}/FRA_registry_{now.strftime("%Y-%m-%d")}.csv'
    
    # Define the URL of the webpage containing the link to the CSV file
    webpage_url = 'https://immat.aviation-civile.gouv.fr/immat/servlet/aeronef_liste.html'  # Replace with the actual URL
    join_url = 'https://immat.aviation-civile.gouv.fr/immat/servlet/'
    
    # Initialize the S3 client
    s3_client = boto3.client('s3', region_name=s3_region)

    try:
        # Download the webpage content
        response = requests.get(webpage_url)
        response.raise_for_status()

        # Parse the HTML content using BeautifulSoup
        soup = BeautifulSoup(response.content, 'html.parser')

        # Find the link to the CSV file using BeautifulSoup
        csv_link = soup.find('a', href=lambda href: href and '.csv' in href)

        if csv_link:
            csv_url = urljoin(join_url, csv_link['href'])

            try:
                # Download the CSV file from the extracted URL
                csv_response = requests.get(csv_url)
                csv_response.raise_for_status()

                # Upload the CSV content to the specified S3 bucket and object
                s3_client.put_object(Bucket=s3_bucket_name, Key=s3_object_key, Body=csv_response.content)

                return {
                    'statusCode': 200,
                    'body': json.dumps(f'CSV file uploaded to S3: {s3_object_key}')
                }
            except requests.exceptions.RequestException as req_err:
                # Handle request-related errors
                return {
                    'statusCode': 500,
                    'body': json.dumps(f'Request failed: {str(req_err)}')
                }
        else:
            return {
                'statusCode': 404,
                'body': json.dumps('CSV file link not found on the webpage.')
            }
    except requests.exceptions.RequestException as e:
        return {
            'statusCode': 500,
            'body': json.dumps(f'Request failed: {str(e)}')
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps(f'Error: {str(e)}')
        }
