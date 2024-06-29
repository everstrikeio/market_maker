docker rm -f everstrike_mm
docker build -t everstrike_mm .
docker run -d --name everstrike_mm everstrike_mm
docker logs -f everstrike_mm
