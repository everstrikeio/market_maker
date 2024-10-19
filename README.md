# Everstrike Market Maker

A simple Everstrike market making bot.

## Features

- Support for 120+ trading pairs (options, futures and spot)
- Plug and play (just set your API key and secret key)
- Minimal dependencies (Node-fetch, WS and Async-Limiter)
- Customizable (more than 40 custom parameters)
- Battle tested (has been running on Everstrike Testnet for more than a year)
- Extendable (based on the popular CCXT crypto trading library)
- MIT license

## Requirements

- Docker
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

Available pairs can be obtained through the /pairs API endpoint:

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

## Configuring long bias

By default, the bot runs with a neutral long bias.

You can configure the long bias in config/config.json.

Positive long bias:

```javascript
  "long_bias": 0.01,
```

Negative long bias (short bias):

```javascript
  "long_bias": -0.01,
```

## Configuring volatility bias

By default, the bot runs with a neutral volatility bias.

You can configure the volatility bias in config/config.json.

Positive volatility bias (long volality):

```javascript
  "volatility_bias": 0.01,
```

Negative volatility bias (short volatility):

```javascript
  "volatility_bias": -0.01,
```

The volatility bias only works for options pairs.

## Configuring order quantity

By default, the bot aims to utilize 10% of your balance.

You can configure the balance target in config/config.json.

For perpetual contracts, modify the "base" property:

```javascript
  "base": 0.30,
```

For spot trading, modify both the "base" and the "quote" properties:

```javascript
  "base": 0.30,
  "quote": 0.40,
```

Note that the target is just a target, and that the bot may overshoot or undershoot the target, depending on the pair quoted. For that reason, it is not recommended to use a balance target that is too high, as doing so may cause orders to fail with insufficient balance errors.

## Turning off buy or sell orders

You may want to make the bot quote in one direction only.

To do so, set "buy" or "sell" to false in config/config.json:

```javascript
  "buy": true,
  "sell": false,
```

## Order placement interval

By default, the bot places orders every 10 seconds.

You can configure the order placement interval in config/config.json:

```javascript
  "order_placement_interval": 20000,
```

## Maximum exposure

By default, the bot stops placing new orders if your exposure (combined notional value of all open positions) is greater than $10,000,000.

You can configure the maximum exposure in config/config.json:

```javascript
  "zero_pos_if_pos_bigger_than": 100000,
```

## Pricing source

By default, the bot uses the Everstrike Index Price as pricing source.

You can change the pricing source to the Everstrike Mark Price in config/config.json:

```javascript
  "use_index": false,
  "use_mark": true,
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
- localhost:8081/configure?pair=USD_BTC_PERP&name=Everstrike_MM&long_bias=0.00&volatility_bias=0.00&spread_multiplier=50

The /configure endpoint mutates internal server state. You can use it to change the long bias, volatility bias and spread for a specific pair, while the bot is running. Simply substitute your desired values into the query string above.

You can check the current configuration of the bot by using the following query:

- localhost:8081/configure?pair=USD_BTC_PERP&name=Everstrike_MM

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

## Trading pairs

As of October 2024, these are the trading pairs supported by Everstrike.

Futures:

- USD_BTC_PERP
- USD_ETH_PERP
- USD_BNB_PERP
- USD_SOL_PERP
- USD_XRP_PERP
- USD_AVAX_PERP
- USD_DOGE_PERP
- USD_ADA_PERP
- USD_LINK_PERP
- USD_APT_PERP
- USD_BCH_PERP
- USD_UNI_PERP
- USD_FIL_PERP
- USD_OP_PERP
- USD_LTC_PERP
- USD_ARB_PERP
- USD_NEAR_PERP
- USD_XLM_PERP
- USD_DOT_PERP
- USD_ICP_PERP
- USD_ETC_PERP
- USD_IMX_PERP
- USD_HBAR_PERP
- USD_CRO_PERP
- USD_FTM_PERP
- USD_INJ_PERP
- USD_AXS_PERP
- USD_ALGO_PERP
- USD_ATOM_PERP

JSON: ["USD_BTC_PERP","USD_ETH_PERP","USD_BNB_PERP","USD_SOL_PERP","USD_XRP_PERP","USD_AVAX_PERP","USD_DOGE_PERP","USD_ADA_PERP","USD_LINK_PERP","USD_APT_PERP","USD_BCH_PERP","USD_UNI_PERP","USD_FIL_PERP","USD_OP_PERP","USD_LTC_PERP","USD_ARB_PERP","USD_NEAR_PERP","USD_XLM_PERP","USD_DOT_PERP","USD_ICP_PERP","USD_ETC_PERP","USD_IMX_PERP","USD_HBAR_PERP","USD_CRO_PERP","USD_FTM_PERP","USD_INJ_PERP","USD_AXS_PERP","USD_ALGO_PERP","USD_ATOM_PERP"]

Options:

- USD_BTCCALL90_PERP
- USD_BTCCALL95_PERP
- USD_BTCCALL97_PERP
- USD_BTCCALL99_PERP
- USD_BTCCALL_PERP
- USD_BTCCALL1_PERP
- USD_BTCCALL3_PERP
- USD_BTCCALL5_PERP
- USD_BTCCALL10_PERP

- USD_BTCPUT90_PERP
- USD_BTCPUT95_PERP
- USD_BTCPUT97_PERP
- USD_BTCPUT99_PERP
- USD_BTCPUT_PERP
- USD_BTCPUT1_PERP
- USD_BTCPUT3_PERP
- USD_BTCPUT5_PERP
- USD_BTCPUT10_PERP

- USD_ETHCALL90_PERP
- USD_ETHCALL95_PERP
- USD_ETHCALL97_PERP
- USD_ETHCALL99_PERP
- USD_ETHCALL_PERP
- USD_ETHCALL1_PERP
- USD_ETHCALL3_PERP
- USD_ETHCALL5_PERP
- USD_ETHCALL10_PERP

- USD_ETHPUT90_PERP
- USD_ETHPUT95_PERP
- USD_ETHPUT97_PERP
- USD_ETHPUT99_PERP
- USD_ETHPUT_PERP
- USD_ETHPUT1_PERP
- USD_ETHPUT3_PERP
- USD_ETHPUT5_PERP
- USD_ETHPUT10_PERP

- USD_XRPCALL20_PERP
- USD_XRPCALL80_PERP
- USD_XRPPUT20_PERP
- USD_XRPPUT80_PERP

- USD_AVAXCALL20_PERP
- USD_AVAXCALL80_PERP
- USD_AVAXPUT20_PERP
- USD_AVAXPUT80_PERP

- USD_DOGECALL20_PERP
- USD_DOGECALL80_PERP
- USD_DOGEPUT20_PERP
- USD_DOGEPUT80_PERP

- USD_ADACALL20_PERP
- USD_ADACALL80_PERP
- USD_ADAPUT20_PERP
- USD_ADAPUT80_PERP

- USD_DOGECALL20_PERP
- USD_DOGECALL80_PERP
- USD_DOGEPUT20_PERP
- USD_DOGEPUT80_PERP

- USD_LINKCALL20_PERP
- USD_LINKCALL80_PERP
- USD_LINKPUT20_PERP
- USD_LINKPUT80_PERP

- USD_LTCCALL20_PERP
- USD_LTCCALL80_PERP
- USD_LTCPUT20_PERP
- USD_LTCPUT80_PERP

- USD_DOTCALL20_PERP
- USD_DOTCALL80_PERP
- USD_DOTPUT20_PERP
- USD_DOTPUT80_PERP

JSON: ["USD_BTCCALL90_PERP","USD_BTCCALL95_PERP","USD_BTCCALL97_PERP","USD_BTCCALL99_PERP","USD_BTCCALL_PERP","USD_BTCCALL1_PERP","USD_BTCCALL3_PERP","USD_BTCCALL5_PERP","USD_BTCCALL10_PERP","USD_BTCPUT90_PERP","USD_BTCPUT95_PERP","USD_BTCPUT97_PERP","USD_BTCPUT99_PERP","USD_BTCPUT_PERP","USD_BTCPUT1_PERP","USD_BTCPUT3_PERP","USD_BTCPUT5_PERP","USD_BTCPUT10_PERP","USD_ETHCALL90_PERP","USD_ETHCALL95_PERP","USD_ETHCALL97_PERP","USD_ETHCALL99_PERP","USD_ETHCALL_PERP","USD_ETHCALL1_PERP","USD_ETHCALL3_PERP","USD_ETHCALL5_PERP","USD_ETHCALL10_PERP","USD_ETHPUT90_PERP","USD_ETHPUT95_PERP","USD_ETHPUT97_PERP","USD_ETHPUT99_PERP","USD_ETHPUT_PERP","USD_ETHPUT1_PERP","USD_ETHPUT3_PERP","USD_ETHPUT5_PERP","USD_ETHPUT10_PERP","USD_XRPCALL20_PERP","USD_XRPCALL80_PERP","USD_XRPPUT20_PERP","USD_XRPPUT80_PERP","USD_AVAXCALL20_PERP","USD_AVAXCALL80_PERP","USD_AVAXPUT20_PERP","USD_AVAXPUT80_PERP","USD_DOGECALL20_PERP","USD_DOGECALL80_PERP","USD_DOGEPUT20_PERP","USD_DOGEPUT80_PERP","USD_ADACALL20_PERP","USD_ADACALL80_PERP","USD_ADAPUT20_PERP","USD_ADAPUT80_PERP","USD_DOGECALL20_PERP","USD_DOGECALL80_PERP","USD_DOGEPUT20_PERP","USD_DOGEPUT80_PERP","USD_LINKCALL20_PERP","USD_LINKCALL80_PERP","USD_LINKPUT20_PERP","USD_LINKPUT80_PERP","USD_LTCCALL20_PERP","USD_LTCCALL80_PERP","USD_LTCPUT20_PERP","USD_LTCPUT80_PERP","USD_DOTCALL20_PERP","USD_DOTCALL80_PERP","USD_DOTPUT20_PERP","USD_DOTPUT80_PERP"]

Spot:

- BTC_USD
- ETH_USD
- BNB_USD
- SOL_USD
- AVAX_USD
- ATOM_USD
- DOT_USD
- LINK_USD
- ADA_USD
- XRP_USD
- ALGO_USD
- USDT_USD

JSON: ["BTC_USD","ETH_USD","BNB_USD","SOL_USD","AVAX_USD","ATOM_USD","DOT_USD","LINK_USD","ADA_USD","XRP_USD","ALGO_USD","USDT_USD"]

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
