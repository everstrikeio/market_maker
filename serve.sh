docker rm -f everstrike_mm
docker build -t everstrike_mm .
docker run -d --name everstrike_mm -p 8081:8081 -e TRADING_ENV=$1 everstrike_mm
docker logs -f everstrike_mm
