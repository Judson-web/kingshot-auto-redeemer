-- Disposable PostgreSQL fixture for the MightPulse provider circuit breaker.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema private;
