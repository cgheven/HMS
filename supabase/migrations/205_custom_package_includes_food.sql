-- Custom packages get a real `includes_food` flag.
--
-- `package_prices._custom` entries carry name and price and nothing else, so a
-- tenant on Chohan B3's "Space + Meals" is stored as package_tier 'space_only'
-- with a custom_package_id, and nothing in the schema says they eat. Reports
-- was inferring it from the package NAME at read time, which means the meal
-- numbers moved whenever someone renamed a package.
--
-- The name is still the only evidence that exists for rows written before this
-- migration, so it is used exactly once — here — to seed the flag. From this
-- point on the flag is set in Settings and nothing guesses again.

update public.hms_package_configs pc
set package_prices = jsonb_set(
      pc.package_prices,
      '{_custom}',
      (
        select jsonb_agg(
          case
            when entry ? 'includes_food' then entry
            else entry || jsonb_build_object(
              'includes_food',
              coalesce(entry->>'name', '') ~* '(^|[^a-z])(meals?|food|khana|khaana|mess|breakfast|lunch|dinner|nashta)([^a-z]|$)'
            )
          end
          order by ord
        )
        from jsonb_array_elements(pc.package_prices->'_custom') with ordinality as t(entry, ord)
      )
    )
where jsonb_typeof(pc.package_prices->'_custom') = 'array'
  and jsonb_array_length(pc.package_prices->'_custom') > 0;
