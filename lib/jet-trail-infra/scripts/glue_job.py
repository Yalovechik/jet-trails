import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job
from awsglue.dynamicframe import DynamicFrame

args = getResolvedOptions(sys.argv, ['JOB_NAME', 'DATABASE_NAME', 'DB_TABLE_NAME', 'CONNECTION_NAME', 'GLUE_DB_NAME', 'GLUE_TABLE_NAME'])
sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args['JOB_NAME'], args)

# Script generated for node AWS Glue Data Catalog
AWSGlueDataCatalog_node1716045151514 = glueContext.create_dynamic_frame.from_catalog(
    database=args['GLUE_DB_NAME'], 
    table_name=args['GLUE_TABLE_NAME'], 
    transformation_ctx="AWSGlueDataCatalog_node1716045151514"
)

# Convert DynamicFrame to DataFrame
df = AWSGlueDataCatalog_node1716045151514.toDF()

# Get the latest month and day values
latest_month_day = df.select("month", "day").distinct().orderBy("month", "day", ascending=[False, False]).first()
latest_month = latest_month_day["month"]
latest_day = latest_month_day["day"]

# Filter the DataFrame to include only the latest partition
df_latest_partition = df.filter((df["month"] == latest_month) & (df["day"] == latest_day))

# Apply the schema transformation
ChangeSchema_node1716045260095 = ApplyMapping.apply(
    frame=DynamicFrame.fromDF(df_latest_partition, glueContext, "df_latest_partition"), 
    mappings=[
        ("immatriculation", "string", "registration", "varchar"), 
        ("constructeur", "string", "manufacturer", "varchar"), 
        ("modele", "string", "type_aircraft", "varchar"), 
        ("numero_serie", "string", "serial_number", "int"), 
        ("aerodrome_attache", "string", "home_airfield", "varchar"), 
        ("proprietaire", "string", "owner_lessor", "varchar"), 
        ("adresse_proprietaire", "string", "owner_address", "varchar"), 
        ("locataire", "string", "beneficiary", "varchar"), 
        ("adresse_locataire", "string", "beneficiary_address", "varchar"), 
        ("creancier_hypotheque", "string", "creditor", "varchar"), 
        ("adresse_creancier", "string", "creditor_address", "varchar"), 
        ("personne_saisissante", "string", "seizing_entity", "varchar"), 
        ("adresse_personne_saisissante", "string", "seizing_entity_address", "varchar")
    ],
    transformation_ctx="ChangeSchema_node1716045260095"
)

# Convert the transformed DynamicFrame to DataFrame
df_transformed = ChangeSchema_node1716045260095.toDF()

# Convert DataFrame back to DynamicFrame
df_dynamic = DynamicFrame.fromDF(df_transformed, glueContext, "df_dynamic")

jdbc_conf = glueContext.extract_jdbc_conf(connection_name=args['CONNECTION_NAME'])

# Define connection options for PostgreSQL
connection_options = {
    "url": '{0}/{1}'.format(jdbc_conf['url'], args['DATABASE_NAME']),
    'user': jdbc_conf['user'],
    'password': jdbc_conf['password'],
    'dbtable': args['DB_TABLE_NAME'],
    'hashfield': 'id',
    
}

# connection_options = {
#     "url": "jdbc:postgresql://db-rest.c0kojcn76fyi.eu-north-1.rds.amazonaws.com:5432/postgres",
#     "dbtable": "aircraft2",
#     "user": "postgres",
#     "password": "Narkolog1993",
# }

# Write the dynamic frame to PostgreSQL using the defined connection
PostgreSQL_node = glueContext.write_dynamic_frame.from_options(
    frame=df_dynamic, 
    connection_type="postgresql", 
    connection_options=connection_options, 
    transformation_ctx="PostgreSQL_node"
)


# Commit the job
job.commit()