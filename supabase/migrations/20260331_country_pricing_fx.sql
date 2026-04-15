-- Local-currency display: multiply PPP-adjusted USD by exchange_rate_per_usd (units of local currency per 1 USD).
-- NULL = legacy behavior (show PPP-adjusted amount with currency_symbol, billed as USD).

ALTER TABLE country_pricing
    ADD COLUMN IF NOT EXISTS exchange_rate_per_usd NUMERIC(12, 4);

COMMENT ON COLUMN country_pricing.exchange_rate_per_usd IS
    'Local currency units per 1 USD (after PPP). E.g. 83 for INR, 0.79 for GBP. NULL = show PPP USD with symbol.';

-- Seed FX + ISO currencies for common rows (admin can tune).
UPDATE country_pricing SET exchange_rate_per_usd = 1.0000, currency_code = 'USD', currency_symbol = '$'
WHERE country_code = 'US';

UPDATE country_pricing SET
    currency_code = 'GBP',
    currency_symbol = '£',
    exchange_rate_per_usd = 0.7900
WHERE country_code = 'GB';

UPDATE country_pricing SET
    currency_code = 'INR',
    currency_symbol = '₹',
    exchange_rate_per_usd = 83.0000
WHERE country_code = 'IN';

UPDATE country_pricing SET
    currency_code = 'BRL',
    currency_symbol = 'R$',
    exchange_rate_per_usd = 5.2000
WHERE country_code = 'BR';

UPDATE country_pricing SET
    currency_code = 'NGN',
    currency_symbol = '₦',
    exchange_rate_per_usd = 1550.0000
WHERE country_code = 'NG';

UPDATE country_pricing SET
    currency_code = 'EUR',
    currency_symbol = '€',
    exchange_rate_per_usd = 0.9200
WHERE country_code = 'DE';

UPDATE country_pricing SET
    currency_code = 'MXN',
    currency_symbol = 'MX$',
    exchange_rate_per_usd = 17.5000
WHERE country_code = 'MX';
