docker rm -f everstrike_mm
docker build -t everstrike_mm .
docker run -d --name everstrike_mm -e TRADING_ENV=$1 everstrike_mm
docker logs -f everstrike_mm
