-- Run ONCE, on mainnet launch day, AFTER the indexer has been switched to mainnet.
-- Removes everything that belongs to the test networks (Base Sepolia 84532, Robinhood
-- testnet 46630): test coins, their trades, comments, orders, alerts, promotions and the
-- indexer's sync markers. Accounts, profiles, follows and invites stay.
-- Mainnet rows (8453 Base, 4663 Robinhood, 56 BNB) are not touched.
begin;
delete from public.trades         where chain_id in (84532, 46630);
delete from public.coin_transfers where chain_id in (84532, 46630);
delete from public.transfer_sync  where chain_id in (84532, 46630);
delete from public.comments       where chain_id in (84532, 46630);
delete from public.orders         where chain_id in (84532, 46630);
delete from public.price_alerts   where chain_id in (84532, 46630);
delete from public.promotions     where chain_id in (84532, 46630);
delete from public.ref_payouts    where chain_id in (84532, 46630);
delete from public.coin_images    where chain_id in (84532, 46630);
delete from public.sync_state     where chain_id in (84532, 46630);
delete from public.coins          where chain_id in (84532, 46630);
-- notifications that point at test coins
delete from public.notifications  where url like '%84532-%' or url like '%46630-%';
commit;
