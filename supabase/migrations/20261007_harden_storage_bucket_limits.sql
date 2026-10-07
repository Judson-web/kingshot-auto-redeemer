begin;

update storage.buckets
set file_size_limit = 10485760
where id = 'kingshot-scraper-archive';

update storage.buckets
set file_size_limit = 1048576
where id = 'kingshot-dr-vault';

commit;
