docker stop jb-router
docker rm jb-router
docker build -t jb-router .
docker run -d --name jb-router -p 20128:20128 --env-file .env -v jb-router-data:/app/data jb-router