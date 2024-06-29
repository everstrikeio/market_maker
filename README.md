# Everstrike Market Maker

A simple Everstrike market making bot.

Connect with Everstrike on social media:

- [twitter.com/everstrike_io](https://twitter.com/everstrike_io)
- [t.me/everstrike_io](https://t.me/everstrike_io)

## Features

- Support for 120+ trading pairs (options, futures and spot)
- Plug and play (just set your API key and secret key)
- Minimal dependencies (Node-fetch, WS and Async-Limiter)
- Extremely customizable (more than 40 custom parameters)
- Battle tested (has been running on Everstrike Testnet for more than a year)
- Extendable (based on the popular CCXT crypto trading library)
- MIT license

## Requirements

- Docker `v20.10.8`
- An Everstrike account with an API key and a secret key

## Local Setup

1. Specify your API key and secret key in config/config.json

```javascript
  "API_KEY": "<YOUR_API_KEY>",
  "SECRET_KEY": "<YOUR_SECRET_KEY>",
```

Generate an API key and a secret key here: [https://app.testnet.everstrike.io/app/apikey](https://app.testnet.everstrike.io/app/apikey)

2. Make sure you have Docker installed

```bash
docker version;
```

3. Build and run Docker image

```bash
bash run.sh;
```

Voilà!

Don't forget to stop your container when you're done.

```bash
docker stop everstrike_mm;
```

The bot automatically cancels all open orders upon being started or shut down.

## Market making multiple pairs

By default, the bot only market makes a single trading pair (USD_BTC_PERP).

However, it can market make up to 50 pairs at once.

Specify the pairs to include in config/config.json:

```javascript
  "PAIRS": ["USD_BTC_PERP", "USD_ETH_PERP", "USD_BTCCALL_PERP"],
```

Available pairs can be obtained through the following API endpoint:

[https://api.testnet.everstrike.io/pairs](https://api.testnet.everstrike.io/pairs)

Alternatively, you may retrieve them through the official frontend UI at [https://app.testnet.everstrike.io/app/trade](https://app.testnet.everstrike.io/app/trade). Make sure to use the programmatic name of each pair, and not the display name (i.e. for "BTC/USD", use "USD_BTC_PERP" instead of "BTC/USD").

## Configuring number of orders

By default, the bot manages up to four orders per trading pair (two on each side of the spread).

However, it can manage up to 20 orders per trading pair.

Specify the number of orders in config/config.json:

```javascript
  "NUM_ORDERS": 10,
```

## Configuring spread

By default, the bot runs with a medium spread (50 pips wide).

You can configure the spread in config/config.json:

```javascript
  "spread_multiplier": 20,
```

## Further customization

Info coming soon.

## Server

To expose the bot's internal server, run

```bash
bash serve.sh;
```

This will run the bot with port 8081 exposed.

Available endpoints:

- localhost:8081/orders
- localhost:8081/positions
- localhost:8081/balances

## Running without Docker

1. Ensure NPM is installed

```bash
npm version;
```

2. Install dependencies

```bash
npm install;
```

3. Start the bot

```bash
npm start;
```

## License

MIT License

Copyright (c) 2023-present Everstrike Labs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
