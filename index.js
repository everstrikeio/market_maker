const ccxt = require('./ccxt');
const bs = require('./bs');
const fetch = require('node-fetch');
const websocket = require('ws');
const http = require('http');
const fs = require('fs');
const config_file = fs.readFileSync('/config/config.json');
const snooze = ms => new Promise(resolve => setTimeout(resolve, ms));
const config = JSON.parse(config_file);
const order_book = {};
const active_orders = {};
const ohlcvs = {};
const current_balances = {};
const current_positions = {};
const vault_rates = {};
const submission_ids = {};
const indices = {};
const wss_orders = {};
const pair_ws = {};
const client_options = {};
const ws_timeouts = {};
const active_clients = [];
var last_call = Date.now();
var sigtermed = false;
var sizes = {};
var start_time;
var orders_submitted_prev_20s = 0;
var orders_submitted_prev_200s = 0;

var OPTIONS = {
  PAIRS: [],
  MAX_RETRIES: 3,
  ORDER_PLACEMENT_INTERVAL: 60000,
  ORDER_PLACEMENT_INTERVAL_MINIMUM: 100,
  ORDER_PLACEMENT_INTERVAL_GRANULARITY: 100,
  WAIT_BEFORE_CANCEL: 0,
  SPREAD_MULTIPLIER: 50,
  LEVERAGE: 1,
  THIRTY_SECOND_ORDER_LIMIT: 50,
  THREE_MINUTE_ORDER_LIMIT: 500,
  RECV_WINDOW: 5000,
  NO_ACTIONS_TIMEOUT_MS: 120000,
  SERVER_ENABLED: true,
  SERVER_PORT: 8081,
  PRICE_CHANGED_NUM_ORDERS: 0,
  INITIAL_WAIT: 1000,
  ORDERS_RETURN_LIMIT: 1000,
  BULK_CANCEL_LIMIT: 1000,
  WS_RECONNECT_INTERVAL: 1000,
  RISK_FREE_INTEREST_RATE: 0.02,
  WS_PING_INTERVAL: 1000,
  SPREAD_BUFFER: 0.001,
  BULK: true,
  FETCH_TICKER: false,
  ORDER_BOOK_DEPTH: 20,
  MAX_EVENTS_STORED: 10000,
  INVENTORY_MULTIPLIER_QTY: 0.05,
  MAX_POSITION: 10000000000,
  MAX_EXPOSURE: 10000000000,
  MAX_DRAWDOWN: 10000000000,
  EPS: 1e-9,
  NUM_ORDERS: 2,
  MIN_ORDERS: 0,
  MAX_STEPS: 100,
  QTY_STRAY: 0.01,
  USE_DYNAMIC_QTY: false,
  BASELINE_PERCENTAGE: {},
  WSS_SUBSCRIBE_PRIVATE: true,
  WSS_SUBSCRIBE_DEPTH: false,
  WSS_SUBSCRIBE_TRADES: false,
  WSS_SUBSCRIBE_PRIVATE_FN: subscribe_private_everstrike,
  WSS_SUBSCRIBE_TRADES_FN: subscribe_trades_everstrike,
  WSS_GET_DEPTH_URL_FN: get_depth_wss_url_everstrike,
  WSS_GET_TRADES_URL_FN: get_trades_wss_url_everstrike,
  WSS_UPDATE_DEPTH_FN: update_ob_wss_everstrike,
  WSS_UPDATE_TRADES_FN: update_trades_wss_everstrike,
  WSS_UPDATE_INDEX_FN: update_index_wss_everstrike,
  WSS_ORDER_ADDED_FN: order_added_wss_everstrike,
  WSS_ORDER_DONE_FN: order_done_wss_everstrike,
  WSS_POSITION_DONE_FN: position_done_wss_everstrike,
  WSS_SUBSCRIBE_DEPTH_FN: null,
  SUBSCRIBE_PAIR_FN: subscribe_pair_everstrike,
  API_KEY_URL: process.env.TRADING_ENV === 'mainnet' ? 'https://app.everstrike.io/app/apikey' : 'https://app.testnet.everstrike.io/app/apikey',
  WSS_URL_BASE: process.env.TRADING_ENV === 'mainnet' ? 'wss://wss.everstrike.io' : 'wss://wss.testnet.everstrike.io'
};
const ONE_SECOND = 1000;

main();

async function main() {
  handle_event_listeners_and_uncaught_exceptions();
  for (var client of config.clients) {
    if (!client.API_KEY && !process.env.EVERSTRIKE_API_KEY) handle_missing_api_key(client);
    if (!client.SECRET_KEY && !process.env.EVERSTRIKE_SECRET_KEY) handle_missing_secret_key(client);
    active_clients.push(get_everstrike(client.API_KEY || process.env.EVERSTRIKE_API_KEY, client.SECRET_KEY || process.env.EVERSTRIKE_SECRET_KEY, client.CLIENT_ID, client.OPTIONS));
  }
  start_time = Date.now();
  for (var client of active_clients) {
    client_options[client.name] = append_options(client, OPTIONS);
  }
  var created_server = OPTIONS.SERVER_ENABLED ? create_server(OPTIONS) : null;
  await snooze(OPTIONS.INITIAL_WAIT);
  track_num_orders_placed();
  for (var client of active_clients) {
    var options = client_options[client.name];
    for (var pair of options.PAIRS) {
      var subscribed_pair = await subscribe_pair(client, pair, options);
    }
  }
  var jobs = [];
  for (var client of active_clients) {
    var options = client_options[client.name];
    var cancelled = await cancel_all_orders(client, options);
    var markets_loaded = await load_markets(client, options);
    await snooze(ONE_SECOND);
    var subscribed_private =  await subscribe_private(client, options);
    for (var pair of options.PAIRS) {
     market_make(client, pair, options);
     await snooze(ONE_SECOND*3);
    }
    var has_vault = client && client.fetch_vault && options.VAULT;
    var fetched_vault = has_vault ? await client.fetch_vault(client, options.VAULT) : null;
    var vault_fetcher = has_vault ? setInterval(async() => {
      await client.fetch_vault(client, options.VAULT);
    }, options.VAULT_FETCH_INTERVAL || (ONE_SECOND*60)) : null;
    setInterval(() => {
      var total_orders = 0;
      for (var pair of Object.keys(active_orders[client.name] || {})) {
        total_orders += (active_orders[client.name][pair] ? active_orders[client.name][pair].length : 0);
        console.info(get_time_string() + " Active " +  pair + " orders: " + (active_orders[client.name][pair] ? active_orders[client.name][pair].length : 0));
      }
      console.info(get_time_string() + " Total active orders: " + (total_orders || 0));
      cancel_stale_orders(client, options);
    }, ONE_SECOND*60);
  }
}

async function cancel_all_orders(client, options, tries) {
  tries = tries || 0;
  var tries_exhausted = tries > options.MAX_RETRIES;
  try {
    var cancelled = await client.cancelOrders(undefined, undefined);
    return cancelled;
  } catch (e) {
    console.error(e);
    await snooze(ONE_SECOND);
    return tries_exhausted ? null : await cancel_all_orders(client, options, tries + 1);
  }
}

async function load_markets(client, options, tries) {
  tries = tries || 0;
  var tries_exhausted = tries > options.MAX_RETRIES;
  try {
    var markets_loaded = await client.load_markets();
  }
  catch (e) {
    console.error(e);
    await snooze(ONE_SECOND);
    return tries_exhausted ? null : await load_markets(client, options, tries + 1);
  }
}

async function subscribe_private(client, options, tries) {
  tries = tries || 0;
  var tries_exhausted = tries > options.MAX_RETRIES;
  try {
    var subscribed_private = options.WSS_SUBSCRIBE_PRIVATE ? options.WSS_SUBSCRIBE_PRIVATE_FN(client, options) : null;
  }
  catch (e) {
    console.error(e);
    await snooze(ONE_SECOND);
    return tries_exhausted ? null : await subscribe_private(client, options, tries + 1);
  }
}

async function subscribe_pair(client, pair, options, tries) {
  tries = tries || 0;
  var tries_exhausted = tries > options.MAX_RETRIES;
  try {
    var subscribed_pair = options.SUBSCRIBE_PAIR_FN ? options.SUBSCRIBE_PAIR_FN(client, pair, options) : null;
  }
  catch (e) {
    console.error(e);
    await snooze(ONE_SECOND);
    return tries_exhausted ? null : await subscribe_pair(client, pair, options, tries + 1);
  }
}

async function fetch_open_orders(client, pair, options, params, tries) {
  tries = tries || 0;
  var tries_exhausted = tries > options.MAX_RETRIES;
  try {
    return await client.fetch_open_orders(pair ? get_pair(client, pair) : undefined, undefined, options.ORDERS_RETURN_LIMIT, params);
  } catch (e) {
    console.error(e);
    await snooze(ONE_SECOND);
    return tries_exhausted ? [] : await fetch_open_orders(client, pair, options, params, tries + 1);
  }
}

async function market_make(client, pair, options) {
  var ensured = ensure_map_entries(client, pair, options);
  var cancelled = cancel_orders(client, pair, options, undefined, undefined, undefined, undefined, undefined, true);
  await cancelled;
  if (options.CLOSE_ACTIVE_POSITIONS_ON_START === true) close_position(client, pair, options);
  var subscribed_depth = options.WSS_SUBSCRIBE_DEPTH ? await options.WSS_SUBSCRIBE_DEPTH_FN(client, pair, options) : null;
  var subscribed_trades = options.WSS_SUBSCRIBE_TRADES ? await options.WSS_SUBSCRIBE_TRADES_FN(client, pair, options) : null;
  process.once('SIGTERM', () => {
    sigtermed = true;
    cancel_orders(client, pair, options, undefined, undefined, undefined, undefined, undefined, true);
    process.exitCode = 1;
    setInterval(cancel_orders.bind(null, client, pair, options, undefined, undefined, undefined, undefined, undefined, true), ONE_SECOND);
  });
  var gotten_balances = await get_balances(client, pair, options);
  var made = await submit_orders_and_wait(client, pair, options, false);
}

async function submit_orders_and_wait(client, pair, options, price_changed) {
  try {
    var bitten = await submit_orders(client, pair, options, price_changed);
    var snoozed = await snooze_with_condition(client, pair, options, bitten);
    ensure_map_entries(client, pair, options);
    return await submit_orders_and_wait(client, pair, options, snoozed.price_changed);
  } catch (e) {
    log_error(e);
    await snooze(get_pair_options(pair, options).order_placement_interval || options.ORDER_PLACEMENT_INTERVAL);
    return await submit_orders_and_wait(client, pair, options, price_changed);
  }
}

function get_empty_book() {
  return {bid: undefined, ask: undefined, spread: undefined, mid: undefined, trade_volatility: undefined, order_flow_factor: undefined, order_flow_mean: undefined, order_flow_std: undefined, order_flow_diff: undefined, order_flow_delta: undefined, bid_pressure: undefined, ask_pressure: undefined, diff_pressure: undefined, real_ask_idx: undefined, real_bid_idx: undefined, bids: [], asks: [], best_bid: undefined, best_ask: undefined}
}

function cancel_existing_orders(client, pair, options, price_changed) {
  var should_use_baseline = true;
  var book = get_empty_book();
  var bid = book.bid;
  var ask = book.ask;
  var spread = book.spread;
  var index_entry = indices[client.name][pair];
  var mark = index_entry && index_entry.mark_price ? index_entry.mark_price : null;
  var index = index_entry && index_entry[get_price_to_use(pair)] ? index_entry[get_price_to_use(pair)] : null;
  var baseline_price = false ? mark : index;
  var mark_spread_ratio = (get_pair_options(pair, options).mark_index_spread * 1);
  bid = should_use_baseline ? baseline_price * (1-mark_spread_ratio) : bid;
  ask = should_use_baseline ? baseline_price * (1+mark_spread_ratio) : ask;
  spread = should_use_baseline ? ask - bid : spread;
  var should_refresh = Math.random() < get_pair_options(pair, options).refresh_factor;
  var reused_active_orders = [];
  var leave_on_book_bids = active_orders[client.name][pair].filter(e => {
    var include_active_order = e.side === 'buy' && e.price <= bid;
    return include_active_order;
  });
  var leave_on_book_asks = active_orders[client.name][pair].filter(e => {
    var include_active_order = e.side === 'sell' && e.price >= ask;
    return include_active_order;
  });
  leave_on_book_bids.sort((a,b) => a.price - b.price);
  leave_on_book_asks.sort((a,b) => b.price - a.price);
  var price_changed_num_orders = get_pair_options(pair, options).price_changed_num_orders || options.PRICE_CHANGED_NUM_ORDERS;
  var min_orders = price_changed ? price_changed_num_orders : (should_refresh ? options.NUM_ORDERS : options.MIN_ORDERS);
  leave_on_book_bids = leave_on_book_bids.slice(0,options.NUM_ORDERS-min_orders);
  leave_on_book_asks = leave_on_book_asks.slice(0,options.NUM_ORDERS-min_orders);
  reused_active_orders = reused_active_orders.concat(leave_on_book_bids).concat(leave_on_book_asks);
  var order_ids_to_exclude = reused_active_orders.map(e => e.id);
  var cancelled = cancel_orders_synchronously(client, pair, options, [], order_ids_to_exclude, active_orders[client.name][pair], options.WAIT_BEFORE_CANCEL, price_changed);
}

function round_up(num, size) {
  var size_inverse = 1 / size;
  var num_rounded = Math.ceil(num*size_inverse) / size_inverse;
  return num_rounded;
}

function round_down(num, size) {
  var size_inverse = 1 / size;
  var num_rounded = Math.floor(num*size_inverse) / size_inverse;
  return num_rounded;
}

async function submit_orders(client, pair, options, price_changed) {
  last_call = Date.now();
  if (sigtermed) return;
  if (funding_is_in_progress()) return;
  console.info(get_time_string() + " " + client.name + " " + "is examining " + pair + ", which has " + (active_orders[client.name][pair] ? active_orders[client.name][pair].length : 0) + " active orders");
  var base = pair.split('_')[is_perp(pair) ? 1 : 0];
  var quote = pair.split('_')[is_perp(pair) ? 0 : 1];
  var balance = current_balances[client.name][pair];
  var min_qty = client.markets[get_pair(client, pair)].limits.amount.min;
  var min_notional = client.markets[get_pair(client, pair)].limits.cost.min;
  var tick_size = client.markets[get_pair(client, pair)].precision.price;
  var position_size = balance && balance.position ? balance.position.size : undefined;
  var skew = 0;
  var should_use_mark = get_pair_options(pair, options).use_mark;
  var should_use_index = get_pair_options(pair, options).use_index;
  var should_use_baseline = should_use_mark || should_use_index;
  var ticker = options.FETCH_TICKER && client.fetch_ticker_native && should_use_baseline ? await client.fetch_ticker_native(client, pair) : null;
  var book = get_empty_book();
  var bid = book.bid;
  var ask = book.ask;
  var spread = book.spread;
  var mid = book.mid;
  var index_entry = ticker || indices[client.name][pair];
  var mark = index_entry && index_entry.mark_price ? index_entry.mark_price : null;
  var index = index_entry && index_entry[get_price_to_use(pair)] ? index_entry[get_price_to_use(pair)] : null;
  var underlying = index_entry && index_entry.underlying_price ? index_entry.underlying_price : null;
  var call = index_entry && index_entry.call ? index_entry.call : false;
  var put = index_entry && index_entry.put ? index_entry.put : false;
  var baseline_price = should_use_mark ? mark : index;
  var mark_spread_ratio = (get_pair_options(pair, options).mark_index_spread * 1);
  var long_bias = get_pair_options(pair, options).long_bias || 0;
  var volatility_bias = call || put ? get_pair_options(pair, options).volatility_bias || 0 : 0;
  long_bias = put ? -long_bias : long_bias;
  bid = should_use_baseline ? baseline_price * (1-mark_spread_ratio) : bid;
  ask = should_use_baseline ? baseline_price * (1+mark_spread_ratio) : ask;
  var price_underlying_ratio = underlying ? baseline_price / underlying : 1;
  var qty_ratio = price_underlying_ratio < 1 ? price_underlying_ratio : price_underlying_ratio;
  var bias_multiplier = 1 / price_underlying_ratio;
  bid = long_bias < 0 && long_bias && bias_multiplier ? bid - (bid * Math.min(1, Math.abs(long_bias || 0) * bias_multiplier)) : bid;
  ask = long_bias > 0 && long_bias && bias_multiplier ? ask + (ask * Math.abs(long_bias || 0) * bias_multiplier) : ask;
  bid = volatility_bias < 0 && volatility_bias && bias_multiplier ? bid - (bid * Math.min(1, Math.abs(volatility_bias || 0) * bias_multiplier)) : bid;
  ask = volatility_bias > 0 && volatility_bias && bias_multiplier ? ask + (ask * Math.abs(volatility_bias || 0) * bias_multiplier) : ask;
  mid = should_use_baseline ? baseline_price : mid;
  spread = should_use_baseline ? ask - bid : spread;
  var num_orders_buy = 0;
  var num_orders_sell = 0;
  var index = 1;
  var base_qty = balance && balance.base && balance.base.free !== undefined ? balance.base.free : 0;
  var quote_qty = balance && balance.quote && balance.quote.free !== undefined ? balance.quote.free : 0;
  var bid_qty_total = is_perp(pair) ? (quote_qty * get_pair_options(pair, options).base / 2) / (baseline_price || mid) * qty_ratio : quote_qty * (get_pair_options(pair, options).quote / mid) / 2;
  var ask_qty_total = is_perp(pair) ? (quote_qty * get_pair_options(pair, options).base / 2) / (underlying || baseline_price || mid) * (1 || price_underlying_ratio) : base_qty * get_pair_options(pair, options).base / 2;
  var jobs = [];
  var reused_active_orders = [];
  var new_buy_orders = [];
  var new_sell_orders = [];
  var is_best_bid_or_ask = false;
  var num_orders = options.NUM_ORDERS;
  var should_refresh = Math.random() < get_pair_options(pair, options).refresh_factor;
  var leave_on_book_price_map = {};
  var bid_ask_multiplier = indices[client.name][pair].spread || 1;
  var leave_on_book_bids = active_orders[client.name][pair].filter(e => {
    var maker_bid = bid - tick_size * bid_ask_multiplier * Math.pow(options.NUM_ORDERS, 1) * 1.1;
    var include_active_order = !leave_on_book_price_map[e.price] && e.side === 'buy' && e.price <= bid && e.price >= maker_bid;
    leave_on_book_price_map[e.price] = include_active_order ? true : leave_on_book_price_map[e.price];
    return Math.random() < (0.005 * (Math.max(1, 300-orders_submitted_prev_200s) / 500) * (Math.max(1, 30-orders_submitted_prev_20s) / 50)) ? false : include_active_order;
  });
  var leave_on_book_asks = active_orders[client.name][pair].filter(e => {
    var maker_ask = ask + tick_size * bid_ask_multiplier * Math.pow(options.NUM_ORDERS, 1) * 1.1;
    var include_active_order = !leave_on_book_price_map[e.price] && e.side === 'sell' && e.price >= ask && e.price <= maker_ask;
    leave_on_book_price_map[e.price] = include_active_order ? true : leave_on_book_price_map[e.price];
    return Math.random() < (0.005 * (Math.max(1, 300-orders_submitted_prev_200s) / 500) * (Math.max(1, 30-orders_submitted_prev_20s) / 50)) ? false : include_active_order;
  });
  leave_on_book_bids.sort((a,b) => a.price - b.price);
  leave_on_book_asks.sort((a,b) => b.price - a.price);
  var price_changed_num_orders = get_pair_options(pair, options).price_changed_num_orders || options.PRICE_CHANGED_NUM_ORDERS;
  var min_orders = price_changed ? price_changed_num_orders : (should_refresh ? options.NUM_ORDERS : options.MIN_ORDERS);
  leave_on_book_bids = leave_on_book_bids.slice(0,options.NUM_ORDERS-min_orders);
  leave_on_book_asks = leave_on_book_asks.slice(0,options.NUM_ORDERS-min_orders);
  reused_active_orders = reused_active_orders.concat(leave_on_book_bids).concat(leave_on_book_asks);
  var max_orders_buy = num_orders - leave_on_book_bids.length;
  var max_orders_sell = num_orders - leave_on_book_asks.length;
  var bid_qty = options.USE_DYNAMIC_QTY && skew < 0 ? bid_qty_total * Math.min(1, (1 / Math.abs(options.INVENTORY_MULTIPLIER_QTY * skew))) : bid_qty_total;
  var ask_qty = options.USE_DYNAMIC_QTY && skew > 0 ? ask_qty_total * Math.min(1, (1 / Math.abs(options.INVENTORY_MULTIPLIER_QTY * skew))) : ask_qty_total;
  var min_price = 0.01;
  var pnl_entry = get_pnl(client);
  var pnl = pnl_entry && pnl_entry[0] ? pnl_entry[0].total || 0 : 0;
  var total_pos = pnl_entry && pnl_entry[0] ? pnl_entry[0].exposure || 0 : 0;
  var reference_price = (underlying || baseline_price || mid);
  var position_notional = position_size * reference_price;
  bid_qty = Math.min(bid_qty, (get_pair_options(pair, options).max_position || options.MAX_POSITION) / reference_price);
  ask_qty = Math.min(ask_qty, (get_pair_options(pair, options).max_position || options.MAX_POSITION) / reference_price);
  bid_qty = position_size > 0 && reference_price ? Math.min(bid_qty, Math.max(0, ((get_pair_options(pair, options).max_position || options.MAX_POSITION) / reference_price) - position_size)) : bid_qty;
  ask_qty = position_size < 0 && reference_price ? Math.min(ask_qty, Math.max(0, ((get_pair_options(pair, options).max_position || options.MAX_POSITION) / reference_price) - Math.abs(position_size))) : ask_qty;
  bid_qty = position_notional && position_notional > (get_pair_options(pair, options).max_position || options.MAX_POSITION) ? 0 : bid_qty;
  ask_qty = position_notional && position_notional < -(get_pair_options(pair, options).max_position || options.MAX_POSITION) ? 0 : ask_qty;
  bid_qty = pnl && get_pair_options(pair, options).max_drawdown && pnl < -(get_pair_options(pair, options).max_drawdown || options.MAX_DRAWDOWN) ? 0 : bid_qty;
  ask_qty = pnl && get_pair_options(pair, options).max_drawdown && pnl < -(get_pair_options(pair, options).max_drawdown || options.MAX_DRAWDOWN) ? 0 : ask_qty;
  bid_qty = total_pos && total_pos > (get_pair_options(pair, options).max_exposure || options.MAX_EXPOSURE) ? 0 : bid_qty;
  ask_qty = total_pos && total_pos > (get_pair_options(pair, options).max_exposure || options.MAX_EXPOSURE) ? 0 : ask_qty;
  bid_qty = get_pair_options(pair, options).buy === false ? 0 : bid_qty;
  ask_qty = get_pair_options(pair, options).sell === false ? 0 : ask_qty;
  var reused_ids = reused_active_orders.map(e => e.id);
  var first_maker_bid;
  var first_maker_ask;
  while (orders_submitted_prev_20s < options.THIRTY_SECOND_ORDER_LIMIT && orders_submitted_prev_200s < options.THREE_MINUTE_ORDER_LIMIT && (num_orders_buy < max_orders_buy || num_orders_sell < max_orders_sell) && index < options.MAX_STEPS) {
    var maker_bid = Math.max(tick_size, bid < tick_size * 20 ? bid - (Math.pow(index,2)*tick_size) : bid - (Math.pow(index,2)*(bid_ask_multiplier*tick_size)));
    var maker_ask = ask + (Math.pow(index,2)*bid_ask_multiplier*tick_size);
    maker_bid = round_down(maker_bid, tick_size);
    maker_ask = round_up(maker_ask, tick_size);
    maker_bid = Math.max(min_price, maker_bid);
    first_maker_bid = first_maker_bid || maker_bid;
    first_maker_ask = first_maker_ask || maker_ask;
    var republish_eps = spread / 20;
    var matching_bids = reused_active_orders.filter(e => e.side === 'buy' && e.price <= first_maker_bid && Math.abs(e.price - maker_bid) <= republish_eps && e.side === 'buy');
    var matching_asks = reused_active_orders.filter(e => e.side === 'sell' && e.price >= first_maker_ask && Math.abs(e.price - maker_ask) <= republish_eps && e.side === 'sell');
    var no_matching_bid = matching_bids.length === 0;
    var no_matching_ask = matching_asks.length === 0;
    var should_place_bid = no_matching_bid && num_orders_buy < max_orders_buy && maker_bid < bid;
    var should_place_ask = no_matching_ask && num_orders_sell < max_orders_sell && maker_ask > ask;
    orders_submitted_prev_20s = orders_submitted_prev_20s || 0;
    orders_submitted_prev_20s = should_place_bid ? orders_submitted_prev_20s + 1 : orders_submitted_prev_20s;
    orders_submitted_prev_20s = should_place_ask ? orders_submitted_prev_20s + 1 : orders_submitted_prev_20s;
    orders_submitted_prev_200s = orders_submitted_prev_200s || 0;
    orders_submitted_prev_200s = should_place_bid ? orders_submitted_prev_200s + 1 : orders_submitted_prev_200s;
    orders_submitted_prev_200s = should_place_ask ? orders_submitted_prev_200s + 1 : orders_submitted_prev_200s;
    var buy_order = should_place_bid ? new_buy_orders.push({pair: pair, qty: bid_qty, side: 'buy', price: maker_bid, params: undefined, num_orders: num_orders_buy}) : null;
    var sell_order = should_place_ask ? new_sell_orders.push({pair: pair, qty: ask_qty, side: 'sell', price: maker_ask, params: undefined, num_orders: num_orders_sell}) : null;
    num_orders_buy = should_place_bid ? num_orders_buy + 1 : num_orders_buy;
    num_orders_sell = should_place_ask ? num_orders_sell + 1 : num_orders_sell;
    index = index + 1;
    is_best_bid_or_ask = !is_best_bid_or_ask && book.best_bid ? (maker_bid >= book.best_bid[0] - republish_eps) || (maker_ask <= book.best_ask[0] + republish_eps) : is_best_bid_or_ask;
  }
  var order_ids_to_exclude = reused_active_orders.map(e => e.id);
  var cancelled = cancel_orders_synchronously(client, pair, options, [], order_ids_to_exclude, active_orders[client.name][pair], options.WAIT_BEFORE_CANCEL, price_changed);
  var done = options.BULK && (get_pair_options(pair, options).submit_even_on_price_changed || !price_changed) ? await submit_orders_in_bulk(client, pair, new_buy_orders, new_sell_orders, min_qty, min_notional, {bid: bid, ask: ask}, options, skew, balance) : (jobs.length > 0 ? await Promise.all(jobs) : []);
  active_orders[client.name][pair] = (done || []).filter(e => e && e.status && e.status === 'open').concat(reused_active_orders);
  return is_best_bid_or_ask;
}

async function submit_orders_in_bulk(client, pair, buy_orders, sell_orders, min_qty, min_notional, spread, options, skew, balance) {
  return is_perp(pair) ? await submit_orders_in_bulk_perp(client, pair, buy_orders, sell_orders, min_qty, min_notional, spread, options, skew, balance) : await submit_orders_in_bulk_spot(client, pair, buy_orders, sell_orders, min_qty, min_notional, spread, options, skew, balance);
}

async function submit_orders_in_bulk_perp(client, pair, buy_orders, sell_orders, min_qty, min_notional, spread, options, skew, balance) {
  var done = await submit_orders_in_bulk_internal(client, pair, buy_orders.concat(sell_orders), min_qty, min_notional, spread, options, skew, balance)
  var new_orders = done && done.result && done.result.orders ? done.result.orders : [];
  return client.parseOrders(new_orders, client.market(pair));
}

async function submit_orders_in_bulk_spot(client, pair, buy_orders, sell_orders, min_qty, min_notional, spread, options, skew, balance) {
  var jobs = [];
  var done_buy = jobs.push(submit_orders_in_bulk_internal(client, pair, buy_orders, min_qty, min_notional, spread, options, skew, balance));
  var done_sell = jobs.push(submit_orders_in_bulk_internal(client, pair, sell_orders, min_qty, min_notional, spread, options, skew, balance));
  var done = await Promise.all(jobs);
  var new_buy_orders = done[0] && done[0].result && done[0].result.orders ? done[0].result.orders : [];
  var new_sell_orders = done[1] && done[1].result && done[1].result.orders ? done[1].result.orders : [];
  return client.parseOrders(new_buy_orders.concat(new_sell_orders), client.market(pair));
}

function transform_qty(client, pair, options, qty, min_qty) {
  return get_pair_options(pair, options).is_perp && min_qty ? round(qty, min_qty) : qty;
}

function round(num,pre) {
  return Math.ceil(num / pre) * pre;
}

async function submit_orders_in_bulk_internal(client, pair, orders, min_qty, min_notional, spread, options, skew, balance) {
  var final_orders = [];
  var qty_so_far_buy = 0;
  var qty_so_far_sell = 0;
  var max_total_qty = get_pair_options(pair, options).max_exposure || 0;
  for (var order of orders) {
    var scaled_qty = get_pair_options(pair, options).scale_fn_base ? (1/Math.pow(get_pair_options(pair, options).scale_fn_base, options.NUM_ORDERS - order.num_orders)) * order.qty : order.qty / options.NUM_ORDERS;
    var transforme_qty = transform_qty(client, pair, options, scaled_qty, min_qty);
    rounded_qty = get_pair_options(pair, options).max ? Math.min(transforme_qty, get_pair_options(pair, options).max) : transforme_qty;
    order.qty = Math.min(Math.max(0, order.side === 'buy' ? max_total_qty - qty_so_far_buy : max_total_qty - qty_so_far_sell), rounded_qty);
    qty_so_far_buy = order.side === 'buy' ? qty_so_far_buy + order.qty : qty_so_far_buy;
    qty_so_far_sell = order.side === 'sell' ? qty_so_far_sell + order.qty : qty_so_far_sell;
    var should_place = rounded_qty >= min_qty && order.qty >= min_qty;
    var pushed = should_place ? final_orders.push(order) : null;
  }
  var tick_size = get_pair_options(pair, options).floor;
  var best_bid = 0;
  var best_ask = Infinity;
  indices[client.name] = indices[client.name] || {};
  indices[client.name][pair] = indices[client.name][pair] || {};
  var index_entry = indices[client.name][pair];
  var index = index_entry && index_entry[get_price_to_use(pair)] ? index_entry[get_price_to_use(pair)] : null;
  var price_selected = {};
  var orders_payload = final_orders.map((e,idx) => {
    var side = e.side;
    var should_post_only = false;
    var should_ks = false;
    var should_reduce_only = false;
    var index_ask = index - (tick_size);
    var index_best_bidbid = index + (tick_size);
    var price = parseFloat(e.price);
    var price_already_quoted = price_selected[price] ? true : false;
    price_selected[price] = true;
    best_bid = side === 'buy' && price > best_bid ? price : best_bid;
    best_ask = side === 'sell' && price < best_ask ? price : best_ask;
    var pair_symbol = pair;
    return price && price !== Infinity && !price_already_quoted ? {pair: pair_symbol, qty: e.qty, price: price, side: side.toUpperCase(), ks: should_ks, post_only: should_post_only, leverage: get_pair_options(pair, options).leverage || options.LEVERAGE || 1, reduce_only: should_reduce_only} : undefined;
  }).filter(e => e);
  var buy_orders = orders_payload.filter(e => e.side === 'BUY');
  var sell_orders = orders_payload.filter(e => e.side === 'SELL');
  for (var order of orders_payload) {
    order.qty = order.qty / (order.side === 'BUY' ? buy_orders.length || 1 : sell_orders.length || 1);
    var transforme_qty = transform_qty(client, pair, options, order.qty, min_qty);
    rounded_qty = get_pair_options(pair, options).max ? Math.min(transforme_qty, get_pair_options(pair, options).max) : transforme_qty;
    order.qty = rounded_qty;
  }
  return orders_payload.length > 0 && is_still_good_price(client, pair, options, best_bid, best_ask) && sigtermed === false ? await submit_orders_everstrike(pair, client, options, {recv_window: options.RECV_WINDOW, orders: orders_payload}, 0) : null;
}

function is_still_good_price(client, pair, options, best_bid, best_ask) {
  indices[client.name] = indices[client.name] || {};
  indices[client.name][pair] = indices[client.name][pair] || {};
  var index_entry = indices[client.name][pair];
  var index = index_entry && index_entry[get_price_to_use(pair)] ? index_entry[get_price_to_use(pair)] : null;
  var bid_is_good = !best_bid ? true : index && best_bid && best_bid < index;
  var ask_is_good = !best_ask ? true : index && best_ask && best_ask > index;
  return bid_is_good && ask_is_good ? true : false;
}

async function submit_orders_everstrike(pair, client, options, payload, tries) {
  try {
    for (var order of false ? [] : payload.orders) {
      console.info(get_time_string() + " " + client.name + " is placing a " + order.qty + " " + pair + " " + order.side.toLowerCase() + " order with price " + (order.price || 0).toFixed(6) + " Quota: " + orders_submitted_prev_20s + "/" + options.THIRTY_SECOND_ORDER_LIMIT + " " + orders_submitted_prev_200s + "/" + options.THREE_MINUTE_ORDER_LIMIT);
    }
    return await client.privatePostAuthOrderBulk(payload);
  } catch (e) {
    console.error(e);
    return null;
  }
}

async function get_open_orders(client, pair, options, open_orders) {
  var fetched_orders = open_orders ? null : await fetch_open_orders(client, pair, options);
  open_orders = open_orders ? open_orders : fetched_orders;
  var has_more = fetched_orders && fetched_orders.length >= options.ORDERS_RETURN_LIMIT;
  while (has_more === true) {
    fetched_orders = await fetch_open_orders(client, pair, options, {end: fetched_orders[0].info.time});
    has_more = fetched_orders && fetched_orders.length >= options.ORDERS_RETURN_LIMIT;
    open_orders = open_orders.concat(fetched_orders);
  }
  return open_orders;
}

function cancel_orders_synchronously(client, pair, options, include, exclude, open_orders, wait, price_changed, force) {
  include = include || [];
  exclude = exclude || [];
  var jobs = [];
  var bulk = [];
  for (var order of open_orders) {
    var should_cancel_specific = should_cancel_order(order, include, exclude);
    if (should_cancel_specific) console.info(get_time_string() + " " + client.name + " is cancelling a " + (order.pair || pair) + " " + order.side.toLowerCase() + " order with price " + (order.price || 0).toFixed(6));
    var pushed_bulk = should_cancel_specific ? bulk.push(order.id) : null;
  }
  var done_bulk = bulk.length > 0 ? cancel_orders_bulk(client, pair, options, bulk) : null;
  return done_bulk;
}


async function cancel_orders(client, pair, options, include, exclude, open_orders, wait, price_changed, force) {
  var open_orders = await get_open_orders(client, pair, options, open_orders);
  include = include || [];
  exclude = exclude || [];
  var jobs = [];
  var bulk = [];
  for (var order of open_orders) {
    var should_cancel_specific = should_cancel_order(order, include, exclude);
    if (should_cancel_specific) console.info(get_time_string() + " "  + client.name + " is cancelling a " + order.pair + " order with price " + order.price);
    var pushed_bulk = should_cancel_specific ? bulk.push(order.id) : null;
  }
  var done_bulk = bulk.length > 0 ? cancel_orders_bulk(client, pair, options, bulk) : null;
  return done_bulk;
}

function cancel_orders_bulk(client, pair, options, ids) {
  orders_submitted_prev_20s = orders_submitted_prev_20s + ids.length;
  orders_submitted_prev_200s = orders_submitted_prev_200s + ids.length;
  var jobs = [];
  for (var i = 0; i < ids.length; i = i + options.BULK_CANCEL_LIMIT) {
    var request_ids = ids.slice(i, i+options.BULK_CANCEL_LIMIT);
    try {
      var pushed = jobs.push(client.privatePostAuthCancelBulk({ids: request_ids}));
      for (var id of request_ids) {
        var idx_0 = active_orders[client.name][pair] ? active_orders[client.name][pair].map(e => e.id).indexOf(id) : null;
        var spliced_0 = true && idx_0 && idx_0 > -1 ? active_orders[client.name][pair].splice(idx_0, 1) : null;
        var idx_1 = wss_orders[client.name][pair] ? wss_orders[client.name][pair].map(e => e.id).indexOf(id) : null;
        var spliced_1 = true && idx_1 && idx_1 > -1 ? wss_orders[client.name][pair].splice(idx_1, 1) : null;
      }
    } catch (e) {
      console.error(e);
    }
  }
  return jobs;
}

function should_cancel_order(order, include, exclude) {
  return (include.length == 0 || include.indexOf(order.id) !== -1) && exclude.indexOf(order.id) === -1
  && (order.info ? order.info.is_liquidation !== true : true);
}

async function get_balances(client, pair, options) {
  var base = pair.split('_')[is_perp(pair) ? 1 : 0];
  var quote = pair.split('_')[is_perp(pair) ? 0 : 1];
  var transformed = pair;
  var balance_base = {free: 0, used: 0, notional: 0, size: 0};
  var balance_quote = {free: 0, used: 0, notional: 0, size: 0};
  var balance_jobs = [];
  var position_jobs = [];
  var pair_position = undefined;
  var balance_clients = [client];
  var contract_clients = is_perp(pair) ? balance_clients : [];
  for (var balance_client of balance_clients) balance_jobs.push(balance_client.fetch_balances(client));
  for (var contract_clients of contract_clients.filter(e => e.fetch_position)) position_jobs.push(contract_clients.fetch_position(contract_clients, transformed));
  var balances = await Promise.all(balance_jobs);
  var positions = await Promise.all(position_jobs);
  for (var balance of balances) {
    if (!balance || !balance[base]) continue;
    balance_base.free += parseFloat(balance[base].free);
    balance_base.used += parseFloat((balance[base].locked + (balance[base].margin || 0)));
  }
  for (var balance of balances) {
    if (!balance || !balance[quote]) continue;
    balance_quote.free += parseFloat(balance[quote].free);
    balance_quote.used += parseFloat((balance[quote].locked + (balance[quote].margin || 0)));
  }
  for (var position of positions.filter(e => e && e.stats)) {
    balance_quote.pnl = balance_quote.pnl || 0;
    balance_base.notional += Math.abs(position.stats.notional_entry);
    balance_quote.notional += Math.abs(position.stats.notional_entry);
    balance_base.size += position.stats.size;
    balance_quote.size += position.stats.size;
    balance_quote.pnl += position.stats.pnl;
    pair_position = transformed === position.pair ? position : pair_position;
  }
  var combined_balance = {base: balance_base, quote: balance_quote, position: pair_position};
  current_balances[client.name][pair] = combined_balance;
  current_positions[client.name][pair] = pair_position;
  return combined_balance;
}

async function fetch_position_everstrike(client, pair) {
  try {
    var positions = await fetch(client.urls.api+'/account', {headers: {'x-api-key': client.apiKey}});
    var positions_json = await positions.json();
    return positions_json && positions_json.result && positions_json.result.positions && positions_json.result.positions[pair] ? positions_json.result.positions[pair] : undefined;
  } catch (e) {console.error(e); return undefined; }
}

async function fetch_positions_everstrike(client) {
  try {
    var positions = await fetch(client.urls.api+'/account', {headers: {'x-api-key': client.apiKey}});
    var positions_json = await positions.json();
    return positions_json && positions_json.result ? positions_json.result.positions : undefined;
  } catch (e) {console.error(e); return undefined; }
}

async function fetch_balances_everstrike(client) {
  try {
    var positions = await fetch(client.urls.api+'/account', {headers: {'x-api-key': client.apiKey}});
    var positions_json = await positions.json();
    return positions_json && positions_json.result ? positions_json.result.balances : undefined;
  } catch (e) {console.error(e); return undefined; }
}

async function fetch_ticker_everstrike(client, pair) {
  try {
    var ticker = await fetch(client.urls.api+'/ticker');
    var ticker_json = await ticker.json();
    var in_programmatic = get_pair(client, pair);
    return ticker_json[in_programmatic];
  } catch (e) {console.error(e); return undefined; }
}

async function fetch_vault_everstrike(client, pair) {
  try {
    var vault = await fetch(client.urls.api+'/vault');
    var vault_json = await vault.json();
    var total = vault_json && vault_json.result && vault_json.result.earnings ? vault_json.result.earnings.total : undefined;
    var supply = vault_json && vault_json.result && vault_json.result.usd_supply ? vault_json.result.usd_supply : undefined;
    var rate = total && supply ? 1 + total / supply : undefined;
    indices[client.name] = indices[client.name] || {};
    indices[client.name][pair] = indices[client.name][pair] || {};
    indices[client.name][pair].mark_price = rate || indices[client.name][pair].mark_price;
    indices[client.name][pair].index_price = indices[client.name][pair].mark_price
    indices[client.name][pair].adjusted_price = indices[client.name][pair].mark_price;
    console.info(get_time_string() + " " + client.name + " " + pair + " rate: " + indices[client.name][pair].mark_price);
  } catch (e) {console.error(e); return undefined; }
}

function get_pair(client, pair) {
  return pair;
}

function ensure_map_entries(client, pair, options) {
  order_book[client.name] = order_book[client.name] || {};
  order_book[client.name][pair] = order_book[client.name][pair] || {last: 0, bids: {}, asks: {}};
  indices[client.name] = indices[client.name] || {};
  indices[client.name][pair] = indices[client.name][pair] || {index_price: undefined, mark_price: undefined, adjusted_price: undefined};
  wss_orders[client.name] = wss_orders[client.name] || {};
  wss_orders[client.name][pair] = wss_orders[client.name][pair] || [];
  active_orders[client.name] = active_orders[client.name] || {};
  active_orders[client.name][pair] = active_orders[client.name][pair] || [];
  current_balances[client.name] = current_balances[client.name] || {};
  current_balances[client.name][pair] = current_balances[client.name][pair] || {};
  current_positions[client.name] = current_positions[client.name] || {};
  current_positions[client.name][pair] = current_positions[client.name][pair] || {};
  ohlcvs[client.name] = ohlcvs[client.name] || [];
  ohlcvs[client.name][pair] = [];
}

function subscribe_private_everstrike(client, options) {
  if (pair_ws['private']) return;
  pair_ws['private'] = pair_ws['private'] || new websocket(options.WSS_GET_DEPTH_URL_FN(null, null, options));
  var ws = pair_ws['private'];
  var pinger = null;
  ws.on('message', (json) => {
    var message = JSON.parse(json);
    var category = message.category;
    switch (category) {
      case 'order_added': return options.WSS_ORDER_ADDED_FN(client, options, message.result);
      case 'order_cancelled': return options.WSS_ORDER_DONE_FN(client, options, message.result);
      case 'order_partially_completed': return options.WSS_ORDER_DONE_FN(client, options, message.result, true);
      case 'order_completed': return options.WSS_ORDER_DONE_FN(client, options, message.result, true);
      default: return null;
    }
  });
  ws.on('close', (err) => {
    return private_on_close_everstrike(client, options, pinger, ws);
  });
  ws.on('error', (err) => {
    log_ws_error(err);
    if (err && (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND')) {
      return private_on_close_everstrike(client, options, pinger, ws);
    }
  });
  ws.on('open', () => {
    log_connected_ws(client.client_id, 'Account Updates');
    pinger = setInterval(() => { ws.send(JSON.stringify({'op': 'status', 'content': 'empty'})); }, options.WS_PING_INTERVAL);
    ws.send(JSON.stringify({op: 'auth_api', content: client.apiKey}));
  });
}

async function subscribe_pair_everstrike(client, pair, options) {
  pair_ws[client.name] = pair_ws[client.name] || {};
  if (pair_ws[client.name][pair]) return;
  pair_ws[client.name][pair] = pair_ws[client.name][pair] || new websocket(options.WSS_GET_DEPTH_URL_FN(null, pair, options));
  var pinger = null;
  var ws = pair_ws[client.name][pair];
  ws.on('message', (json) => {
    var message = JSON.parse(json);
    var category = message.category;
    switch (category) {
      case 'depth': {
        options.WSS_UPDATE_DEPTH_FN(client, pair, options, message.result.depth);
        break;
      }
      case 'index': {
        options.WSS_UPDATE_INDEX_FN(client, pair, options, message.result);
        break;
      }
      default: return null;
    }
  });
  ws.on('close', (e) => {
    return pair_on_close_everstrike(client, pair, options, pinger, ws);
  });
  ws.on('error', (err) => {
    log_ws_error(err);
    if (err && (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND')) {
      return pair_on_close_everstrike(client, pair, options, pinger, ws);
    }
  });
  ws.on('open', () => {
    log_connected_ws(client.client_id, pair);
    pinger = setInterval(() => { ws.send(JSON.stringify({'op': 'status', 'content': 'empty'})); }, options.WS_PING_INTERVAL);
    ws.send(JSON.stringify({op: 'sub', content: pair+':depth'}));
    ws.send(JSON.stringify({op: 'sub', content: get_perp_pair(pair)+':index'}));
  });
}

async function post_leverage(client, pair, options) {
  var perp_pair = pair;
  var has_position = current_positions[client.name] && current_positions[client.name][pair] && current_positions[client.name][pair].stats && current_positions[client.name][pair].stats.size;
  return has_position ? await client.privatePostLeverage({pair: pair, leverage: get_pair_options(pair, options).leverage}) : null;
}

async function close_position(client, pair, options) {
  var perp_pair = pair;
  return await client.privatePostAuthClose({pair: pair, qty: Math.random()*options.CLOSE_QTY});
}

function private_on_close_everstrike(client, options, pinger, ws) {
  log_closed_ws(client.client_id, 'Private');
  clearInterval(pinger);
  ws.removeAllListeners();
  pair_ws['private'] = null;
  clearTimeout(ws_timeouts['private']);
  ws_timeouts['private'] = setTimeout(subscribe_private_everstrike.bind(null, client, options), options.WS_RECONNECT_INTERVAL);
}

function pair_on_close_everstrike(client, pair, options, pinger, ws) {
  log_closed_ws(client.client_id, pair);
  clearInterval(pinger);
  ws.removeAllListeners();
  pair_ws[client.name] = pair_ws[client.name] || {};
  pair_ws[client.name][pair] = null;
  clearTimeout(ws_timeouts[pair]);
  ws_timeouts[pair] = setTimeout(subscribe_pair_everstrike.bind(null, client, pair, options, pinger, ws), options.WS_RECONNECT_INTERVAL);
}

async function subscribe_trades_everstrike(client, pair, options) {
  return true;
}

async function snooze_with_condition(client, pair, options, is_best_bid_or_ask) {
  var i = 0;
  var order_placement_interval = get_pair_options(pair, options).order_placement_interval || options.ORDER_PLACEMENT_INTERVAL;
  var granularity = options.ORDER_PLACEMENT_INTERVAL_GRANULARITY;
  var initial = await snooze(options.ORDER_PLACEMENT_INTERVAL_MINIMUM);
  while (i < granularity) {
    var is_price_changed = price_is_changed(client, pair, options);
    var cancelled_exist = is_price_changed.result ? cancel_existing_orders(client, pair, options, true) : null;
    if (is_price_changed.result) return {price_changed: is_price_changed.result, resume: true};
    await snooze((order_placement_interval - options.ORDER_PLACEMENT_INTERVAL_MINIMUM) / granularity);
    i++;
  }
  return {price_changed: false, resume: true};
}

function get_ask_for_spread(ask, bid, index, options, pair) {
  var spread = (get_pair_options(pair, options).mark_index_spread * 1);
  var spread_ask = (bid < index) || (bid < index - (index * spread)) ? Math.min(ask, index + Math.abs(bid - index)) : ask;
  return spread_ask;
}

function get_bid_for_spread(ask, bid, index, options, pair) {
  var spread = (get_pair_options(pair, options).mark_index_spread * 1);
  var spread_bid = (ask > index) || (ask > index + (index * spread)) ? Math.max(bid, index - Math.abs(ask - index)) : bid;
  return spread_bid;
}

function price_is_changed(client, pair, options) {
  var index_entry = indices[client.name][pair];
  var index = index_entry && index_entry[get_price_to_use(pair)] ? index_entry[get_price_to_use(pair)] : null;
  if (!index) return false;
  active_orders[client.name] = active_orders[client.name] || {};
  active_orders[client.name][pair] = active_orders[client.name][pair] || [];
  var bids = active_orders[client.name][pair].filter(e => e.side === 'buy');
  bids.sort((a,b) => b.price - a.price);
  var asks = active_orders[client.name][pair].filter(e => e.side === 'sell');
  asks.sort((a,b) => a.price - b.price);
  var own_best_bid = bids[0];
  var own_best_ask = asks[0];
  var bid_diff = own_best_bid ? index - own_best_bid.price : 0;
  var ask_diff = own_best_ask ? own_best_ask.price - index : 0;
  var spread = own_best_bid && own_best_ask && own_best_bid.price && own_best_ask.price ? Math.abs(get_ask_for_spread(own_best_ask.price, own_best_bid.price, index, options, pair) - get_bid_for_spread(own_best_ask.price, own_best_bid.price, index, options, pair)) : 0;
  var is_index_below_bid = ((own_best_bid && own_best_bid.price && index < own_best_bid.price)) || (spread && (bid_diff < spread * (get_pair_options(pair, options).spread_buffer || 0)));
  var is_index_above_ask = ((own_best_ask && own_best_ask.price && index >= own_best_ask.price)) || (spread && (ask_diff < spread * (get_pair_options(pair, options).spread_buffer || 0)));
  var is_bid_stale = ((own_best_bid && own_best_bid.price && index > own_best_bid.price)) && (spread && (bid_diff > spread * (get_pair_options(pair, options).stale_buffer || 1)));
  var is_ask_stale = ((own_best_ask && own_best_ask.price && index < own_best_ask.price)) && (spread && (ask_diff > spread * (get_pair_options(pair, options).stale_buffer || 1)));
  var result = {result: is_index_below_bid || is_index_above_ask};
  return result;
}

function parse_ob(client, pair, options, level) {
  var bids = Object.keys(level.bids).map(e => [parseFloat(e), parseFloat(level.bids[e].qty_string), level.bids[e].events]).filter(e => e[1] > options.EPS).sort((a,b) => b[0]-a[0]).slice(0, options.ORDER_BOOK_DEPTH);
  var asks = Object.keys(level.asks).map(e => [parseFloat(e), parseFloat(level.asks[e].qty_string), level.asks[e].events]).filter(e => e[1] > options.EPS).sort((a,b) => a[0]-b[0]).slice(0, options.ORDER_BOOK_DEPTH);
  return {nonce: level.last, bids: bids, asks: asks};
}

function append_options(client, options) {
  return Object.assign(options, client.options);
}

async function fetch_ob(client, pair, options, use_wss) {
  return use_wss ? parse_ob(client, pair, options, order_book[client.name][pair]) : await client.fetch_order_book(get_pair(client, pair), options.ORDER_BOOK_DEPTH);
}

function get_depth_wss_url_everstrike(client, pair, options) {
  return options.WSS_URL_BASE;
}

function get_trades_wss_url_everstrike(client, pair, options) {
  return options.WSS_URL_BASE;
}

async function update_trades_wss_everstrike(client, pair, options, data) {
  return true;
}

function is_perp(pair) {
  return pair && pair.indexOf('PERP') !== -1;
}

function get_perp_pair(pair) {
  return is_perp(pair) ? pair : 'USD_' + pair.split('_')[0] + '_PERP';
}

function get_price_to_use(pair) {
  return 'adjusted_price';
}

function update_ob_level_everstrike(client, pair, options, entry, bids, asks, is_bid, nonce) {
  var collection = is_bid ? bids : asks;
  var price = entry.price;
  var qty = entry.qty;
  var current_entry = collection[price] ? collection[price] : {qty: 0, price: parseFloat(price), qty_string: '0', price_string: price, events: []};
  var current_qty = current_entry.qty;
  var new_qty = parseFloat(qty);
  var delta = new_qty - current_qty;
  var is_add = delta >= 0;
  var is_cancel = delta < 0;
  var current_event = {is_add: is_add, is_cancel: is_cancel, time: Date.now(), delta: delta, current_qty: current_qty, new_qty: new_qty, price: parseFloat(price)};
  current_entry.qty = new_qty;
  current_entry.qty_string = qty;
  current_entry.events.push(current_event);
  current_entry.nonce = nonce;
  var shifted = current_entry.events.length > options.MAX_EVENTS_STORED ? current_entry.events.shift() : null;
  if (parseFloat(entry[1]) <= options.EPS) delete collection[price];
  else collection[price] = current_entry;
}

async function order_added_wss_everstrike(client, options, data) {
  var pair = data && data.order ? data.order.pair: null;
  var transformed = data && data.order && data.order.pair ? data.order.pair : null;
  if (!pair) return;
  wss_orders[client.name] = wss_orders[client.name] || {};
  wss_orders[client.name][pair] = wss_orders[client.name][pair] || [];
  active_orders[client.name] = active_orders[client.name] || {};
  var already_done = data && data.order && data.order.id && submission_ids[client.name] && submission_ids[client.name][pair] && submission_ids[client.name][pair][data.order.id];
  var pushed = data && data.order && wss_orders[client.name][pair].map(e => e.id).indexOf(data.order.id) === -1 && already_done !== true ? wss_orders[client.name][pair].push(client.parseOrder(data.order, client.market(transformed))) : null;
  active_orders[client.name][pair] = active_orders[client.name][pair] || [];
  var pushed = true && data && data.order && active_orders[client.name][pair].map(e => e.id).indexOf(data.order.id) === -1 && already_done !== true ? active_orders[client.name][pair].push(client.parseOrder(data.order, client.market(transformed))) : null;
}

async function order_done_wss_everstrike(client, options, data, is_fill) {
  if (data && data.order && !is_fill) console.info(get_time_string() + " " + data.order.pair + " " + data.order.side.toLowerCase() + " order with price " + data.order.price + " has received an update: " + data.order.msg);
  if (data && data.order && is_fill) console.info(get_time_string() + " " + data.order.pair + " " + data.order.side.toLowerCase() + " order with price " + data.order.price + " is now " + (parseFloat((data.order.qty_orig - (data.order.qty_remaining || 0)) / data.order.qty_orig * 100) || 0).toFixed(2) + "% filled");
  var pair = data && data.order ? data.order.pair : null;
  var transformed = data && data.order && data.order.pair ? data.order.pair : null;
  if (!pair) return;
  wss_orders[client.name] = wss_orders[client.name] || {};
  wss_orders[client.name][pair] = wss_orders[client.name][pair] || [];
  active_orders[client.name] = active_orders[client.name] || {};
  var idx = data && data.order ? wss_orders[client.name][pair].map(e => e.id).indexOf(data.order.id) : null;
  var spliced = idx && idx > -1 ? wss_orders[client.name][pair].splice(idx, 1) : null;
  var idx = data && data.order && active_orders[client.name][pair] ? active_orders[client.name][pair].map(e => e.id).indexOf(data.order.id) : null;
  var spliced = true && idx && idx > -1 ? active_orders[client.name][pair].splice(idx, 1) : null;
  submission_ids[client.name] = submission_ids[client.name] || {};
  submission_ids[client.name][pair] = submission_ids[client.name][pair] || {};
  if (data && data.order && data.order.id) submission_ids[client.name][pair][data.order.id] = true;
  var balance = await get_balances(client, pair, options, false);
  if (data && data.order && is_fill && options.SLACK_WEBHOOK_URL) slack(options.SLACK_WEBHOOK_URL, get_time_string() + " " + data.order.pair + " " + data.order.side.toLowerCase() + " order with price " + data.order.price + " is now " + (parseFloat((data.order.qty_orig - (data.order.qty_remaining || 0)) / data.order.qty_orig * 100) || 0).toFixed(2) + "% filled");
}

function update_index_wss_everstrike(client, pair, options, data) {
  indices[client.name] = indices[client.name] || {};
  indices[client.name][pair] = indices[client.name][pair] || {mark_price: undefined, index_price: undefined, adjusted_price: undefined, external_price: undefined};
  indices[client.name][pair].index_price = data && data.index ? data.index : indices[client.name][pair].index_price;
  indices[client.name][pair].mark_price = data && data.mark ? data.mark : indices[client.name][pair].mark_price;
  var atm_pct = Math.abs(data.strike - data.underlying_price) / data.underlying_price;
  var is_option = (pair.indexOf('CALL') !== -1 || pair.indexOf('PUT') !== -1);
  var is_future = !is_option && (pair.indexOf('PERP') !== -1);
  var black_scholes = is_option ? bs.blackScholes(data.underlying_price, data.strike, 1/365/12, data.volatility, options.RISK_FREE_INTEREST_RATE, pair.indexOf('PUT') !== -1 ? "put" : "call" ) : null;
  black_scholes = Math.max(0.000125 * data.underlying_price, black_scholes);
  var spread = Math.max(1, Math.min(10, parseInt(1 * 10 * 0.5 * data.volatility * Math.max(0.25, Math.min(1, (black_scholes/data.underlying_price*50))))));
  indices[client.name][pair].spread = spread * (get_pair_options(pair, options)['spread_multiplier_' + (is_option ? 'options' : (is_future ? 'futures' : 'spot'))] || get_pair_options(pair, options).spread_multiplier || options.SPREAD_MULTIPLIER || 1);
  var supplied_bs = data && data.black_scholes ? data.black_scholes : null;
  indices[client.name][pair].underlying_price = data.underlying_price;
  indices[client.name][pair].call = pair.indexOf('CALL') !== -1;
  indices[client.name][pair].put = pair.indexOf('PUT') !== -1;
  var should_use_mark = get_pair_options(pair, options).use_mark;
  indices[client.name][pair].mark_price = is_option ? supplied_bs || black_scholes || indices[client.name][pair].index_price : indices[client.name][pair].mark_price;
  indices[client.name][pair].adjusted_price = indices[client.name][pair][is_option || should_use_mark ? 'mark_price' : 'index_price'];
  var is_price_changed = price_is_changed(client, pair, options);
  var cancelled_exist = is_price_changed.result ? cancel_existing_orders(client, pair, options, true) : null;
}

async function update_ob_wss_everstrike(client, pair, options, data) {
  order_book[client.name] = order_book[client.name] || {};
  order_book[client.name][pair] = order_book[client.name][pair] || {bids: {}, asks: {}};
  var bids = order_book[client.name][pair].bids;
  var asks = order_book[client.name][pair].asks;
  var current_bid_entries = Object.keys(bids);
  var current_ask_entries = Object.keys(asks);
  var new_bid_entries = data.bids.map(e => e.price);
  var new_ask_entries = data.asks.map(e => e.price);
  for (var bid of data.bids) update_ob_level_everstrike(client, pair, options, bid, bids, asks, true, 0);
  for (var ask of data.asks) update_ob_level_everstrike(client, pair, options, ask, bids, asks, false, 0);
  var clear = true;
  for (var entry of clear ? current_bid_entries.filter(e => new_bid_entries.indexOf(e) === -1) : []) delete order_book[client.name][pair].bids[entry];
  for (var entry of clear ? current_ask_entries.filter(e => new_ask_entries.indexOf(e) === -1) : []) delete order_book[client.name][pair].asks[entry];
}

async function position_done_wss_everstrike(client, options, data) {
  var pair = data && data.order && data.order.pair ? data.order.pair : null;
  var balance = await get_balances(client, pair, options, false);
  return;
  try {return await client.privatePostLeverage({pair: data.order.pair, leverage: get_pair_options(pair, options).leverage})} catch (e) { console.error(e); }
}

function get_everstrike(api_key, secret_key, client_id, additional_options) {
  const everstrike = new ccxt['Everstrike']({verbose: false, apiKey: api_key, secret: secret_key, timeout: 30000, enableRateLimit: false, adjustForTimeDifference: true});
  everstrike.fetch_position = fetch_position_everstrike;
  everstrike.fetch_positions = fetch_positions_everstrike;
  everstrike.fetch_balances = fetch_balances_everstrike;
  everstrike.fetch_ticker_native = fetch_ticker_everstrike;
  everstrike.fetch_vault = fetch_vault_everstrike;
  everstrike.urls.api = process.env.API_URL || (process.env.TRADING_ENV === 'mainnet' ? everstrike.urls.api : everstrike.urls.test || everstrike.urls.api);
  everstrike.options = additional_options;
  everstrike.name = client_id;
  everstrike.client_id = everstrike.name;
  return everstrike;
}

function down(multiple, qty) {
  return Math.floor(qty / multiple) * multiple;
}

function up(multiple, qty) {
  return Math.ceil(qty / multiple) * multiple;
}

function floor(decimals, qty) {
  return Math.floor(qty * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function get_pnl(specific_client) {
  var entries = [];
  for (var client of (specific_client ? [specific_client] : active_clients)) {
    var options = client_options[client.name] || {};
    var total_upnl = 0;
    var total_rpnl = 0;
    var total_exposure = 0;
    var balances = current_balances[client.name];
    for (var pair of (options.PAIRS || [])) {
      if (!balances[pair]) continue;
      var position = balances[pair].position;
      var quote = balances[pair].quote;
      var upnl = position && position.stats ? position.stats.pnl : 0;
      var rpnl = position ? position.cum_pnl : 0;
      var exposure = position && position.stats ? Math.abs(position.stats.notional_entry || 0) : 0;
      total_upnl += upnl;
      total_rpnl += rpnl;
      total_exposure += exposure;
    }
    entries.push({name: client.name, upnl: total_upnl, rpnl: total_rpnl, total: total_upnl + total_rpnl, exposure: total_exposure});
  }
  return entries;
}

function track_num_orders_placed() {
  setInterval(() => {
    orders_submitted_prev_20s = 0;
  }, 20*ONE_SECOND);

  setInterval(() => {
    orders_submitted_prev_200s = 0;
  }, 200*ONE_SECOND);
}

async function exit(client, pair, options) {
  var cancelled = await cancel_orders(client, pair, options, undefined, undefined, undefined, undefined, undefined, true);
  throw Error('Exiting...');
}

function create_server(options) {
  http.createServer((req, res) => {
    var url = req.url;
    var ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;
    console.info(get_time_string() + " Served request: " + url + " from " + ip);
    req.params = params(req);
    var base_url = url.indexOf('?') !== -1 ? url.split('?')[0] : url;
    if(base_url ==='/ok') {
      var is_ok = (Date.now() - last_call) < options.NO_ACTIONS_TIMEOUT_MS;
      var status = is_ok ? 200 : 500;
      res.writeHead(status, {'Content-Type': 'text/plain'});
      return is_ok ? res.end('ok') : res.end('not active');
    }
    else if(base_url ==='/orders') {
      res.writeHead(200, {'Content-Type': 'application/json'});
      return res.end(JSON.stringify(active_orders));
    }
    else if(base_url ==='/balances') {
      res.writeHead(200, {'Content-Type': 'application/json'});
      return res.end(JSON.stringify(current_balances));
    }
    else if(base_url ==='/positions') {
      res.writeHead(200, {'Content-Type': 'application/json'});
      return res.end(JSON.stringify(current_positions));
    }
    else if(base_url ==='/pnl') {
      res.writeHead(200, {'Content-Type': 'application/json'});
      return res.end(JSON.stringify(get_pnl()));
    }
    else if(base_url ==='/configure') {
      res.writeHead(200, {'Content-Type': 'application/json'});
      var long_bias = req.params ? req.params.long_bias : null;
      var volatility_bias = req.params ? req.params.volatility_bias : null;
      var spread_multiplier = req.params ? req.params.spread_multiplier : null;
      var buy = req.params ? req.params.buy : null;
      var sell = req.params ? req.params.sell : null;
      var pair = req.params ? req.params.pair : null;
      var name = req.params ? req.params.name : null;
      var options = name ? client_options[name] : null;
      var pair_options = options && pair ? get_pair_options(pair, options) : null;
      var should_cancel = (buy && buy !== 'true' && pair_options && pair_options.buy === true) || (sell && sell !== 'true' && pair_options && pair_options.sell === true) ;
      if (pair_options) {
        if (long_bias || long_bias === 0) pair_options.long_bias = long_bias;
        if (volatility_bias || volatility_bias === 0) pair_options.volatility_bias = volatility_bias;
        if (spread_multiplier || spread_multiplier === 0) pair_options.spread_multiplier = spread_multiplier;
        if (buy) pair_options.buy = buy === 'true' ? true : false;
        if (sell) pair_options.sell = sell === 'true' ? true : false;
      }
      var client = active_clients.filter(e => e && e.name === name)[0];
      if (should_cancel && client && pair && options) {
        for (var pair of (options.PAIRS || [])) cancel_orders(client, pair, options, undefined, undefined, undefined, undefined, undefined, true);
      }
      return pair_options ? res.end(JSON.stringify({success: true, pair: pair, buy: pair_options.buy, sell: pair_options.sell, long_bias: pair_options.long_bias, volatility_bias: pair_options.volatility_bias, spread_multiplier: pair_options.spread_multiplier})) : res.end(JSON.stringify({success: false, reason: "Unknown client or pair"}));
    }
    res.writeHead(404, {'Content-Type': 'text/plain'});
    return res.end('not found');
  }).listen(options.SERVER_PORT);
  console.info(get_time_string() + " Server listening on port " + options.SERVER_PORT);
}

function params(req){
  let q = req.url.split('?'),result={};
  if(q.length >= 2){
      q[1].split('&').forEach((item)=>{
           try {
             result[item.split('=')[0]]=item.split('=')[1];
           } catch (e) {
             result[item.split('=')[0]]='';
           }
      })
  }
  return result;
}

function is_insufficient_balance(error) {
  return error.message.includes('Your request was rejected due to insufficient balance.');
}

function log_connected_ws(client_name, feed_id) {
  console.info(get_time_string() + " " + client_name + " connected to feed: " + feed_id);
}

function log_closed_ws(client_name, feed_id) {
  console.info(get_time_string() + " " + client_name + " disconnected from feed: " + feed_id);
}

function handle_missing_api_key(client) {
  console.info("API key missing for " + client.CLIENT_ID + ". Get an API key at " + OPTIONS.API_KEY_URL);
}

function handle_missing_secret_key(client) {
  console.info("Secret key missing for " + client.CLIENT_ID + ". Get a secret key at " + OPTIONS.API_KEY_URL);
}

function log_ws_error(err) {
  console.info(get_time_string() + " " + err.message);
}

function log_error(e) {
  var should_log = e.message.includes('The order was not found') !== true;
  var logged = should_log ? console.error(e) : null;
}

function get_time_string() {
  return new Date().toTimeString().split(' ')[0] + ":" + new Date().getMilliseconds();
}

function handle_event_listeners_and_uncaught_exceptions() {
  require('events').EventEmitter.defaultMaxListeners = 100;
  process.on('uncaughtException', err => { console.error(err, 'Uncaught Exception thrown'); });
}

async function slack(webhook_url, text) {
  const body = {text: text};
  const done = await fetch(webhook_url, {method: 'POST', body: JSON.stringify(body), headers: {'Content-type': 'application/json'}});
}

function funding_is_in_progress() {
  var date = new Date;
  var seconds = date.getSeconds();
  var minutes = date.getMinutes();
  return (minutes === 59 && seconds >= 30) || (minutes === 0 && seconds <= 30);
}

function get_pair_options(pair, options) {
  var pair_options = options && options.PAIR_OPTIONS ? options.PAIR_OPTIONS : null;
  var first_pair = pair_options && Object.keys(pair_options) ? Object.keys(pair_options)[0] : null;
  return pair_options && pair_options[pair] ? pair_options[pair] : (first_pair ? pair_options[first_pair] : null);
}

async function cancel_stale_orders(client, options) {
  var open_orders = await get_open_orders(client, undefined, options);
  var jobs = [];
  var bulk = [];
  for (var order of open_orders)  {
    var pair = order.symbol ? order.symbol : undefined;
    var index = indices && indices[client.name] && indices[client.name][pair] ? indices[client.name][pair].mark_price : undefined;
    var should_cancel_specific = index && (order.side === 'buy' && order.price > index) || (order.side === 'sell' && order.price < index);
    if (should_cancel_specific) console.info(get_time_string() + ' ' + client.name + ' is cancelling a stale ' + pair + ' order with price ' + order.price);
    var pushed_bulk = should_cancel_specific ? bulk.push(order.id) : null;
  }
  var done_bulk = bulk.length > 0 ? cancel_orders_bulk(client, pair, options, bulk) : null;
  return done_bulk;
}
