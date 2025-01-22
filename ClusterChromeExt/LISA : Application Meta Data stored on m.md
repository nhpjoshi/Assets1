LISA : Application Meta Data stored on mongoDB


Embedded Finance : Lender is the cient , NBFC They have create Loan Origination System 
You have money , I 

Infrastructre is controlled by the customer 




Production data is on MongoDB , 

315 TB on DynamoDB , Accumulation from last 5 years , without having TTL --- 

Cost is one of the pain 

DynamoDB and Cosomos DB is comparable  (Performance letancy) , Managed Clickhouse service is used to replace 

NTC customer : He wants immediate money --



testprojectnj
docker build -t gcr.io/testprojectnj/servercluster .

docker tag server2 gcr.io/testprojectnj/server2

docker push gcr.io/testprojectnj/servercluster


gcloud projects get-iam-policy testprojectnj

sudo -u $USER docker push gcr.io/testprojectnj/server2


gcloud projects add-iam-policy-binding testprojectnj  \
  --member="user:nitish.joshi@mongodb.com" \
  --role="roles/storage.admin"


gcloud projects add-iam-policy-binding testprojectnj \
    --member="user:nitish.joshi@mongodb.com" \
    --role="roles/editor"


https://servercluster-49667760259.asia-south1.run.app/clusters

https://server3-49667760259.asia-south1.run.app


gcloud run deploy gcr.io/testprojectnj/server_test \
    --image gcr.io/testprojectnj/server_test:latest \
    --platform managed \
    --region us-central1 \
    --allow-unauthenticated

gcloud run deploy server1 \
    --source . \
    --region us-central1 \
    --platform managed \
    --allow-unauthenticated 


docker build -t gcr.io/[PROJECT_ID]/servercluster .


gcloud artifacts repositories create server \
    --repository-format=docker \
    --location=us0central1 \
    --description="Docker repository for Node.js Hello World app"


docker tag samplecluster:latest us-central1-docker.pkg.dev/testprojectnj/server/samplecluster:latest

docker push us-central1-docker.pkg.dev/testprojectnj/server/server3:latest
