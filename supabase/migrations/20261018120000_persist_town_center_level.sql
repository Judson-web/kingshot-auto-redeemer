-- Persist the provider's numeric Town Center progression value for admin/profile views.
-- TEXT keeps the column compatible with pre-existing databases that may already use a text field.
alter table public.kingshot_autoredeem
  add column if not exists town_center_level text;
