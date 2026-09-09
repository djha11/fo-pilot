# F&O Pilot paper engine

Initial paper-only API. Live trading is hard-disabled until a broker developer API,
market-data adapter, authentication, and production readiness checks are completed.

Risk policy:

- Capital: INR 50,000
- Maximum planned all-in loss per trade: INR 350
- Daily loss limit: INR 600
- Minimum calibrated probability of profit: 95%
- Maximum simultaneous positions: 1
- No qualifying signal means no trade

Learning loop:

- Every completed paper trade stores its original signal, net result, charges, and exit reason.
- Comparable trades are grouped by strategy and expiry-day status.
- Bayesian smoothing prevents a few lucky or unlucky trades from changing rankings.
- A group needs 30 completed trades before its adjustment becomes active.
- Learning can move ranking score by at most 5 points and cannot weaken POP or loss limits.

Historical training:

- Downloads 30-minute NIFTY candles from January 2022 in quarterly API windows.
- Uses the oldest 80% for training and keeps the newest 20% untouched for validation.
- Learns conservative gap, range, and realized-volatility rejection thresholds.
- Activates only when it reduces large-move frequency on at least 60 accepted validation days.
- This is a market-regime safety filter, not proof of options profitability or a 95% win rate.
