-- Update validate_draft_payload to accept sighting version 2 with selectedStores and photoUrls.
-- The frontend (NewSighting.tsx) evolved to version 2 with selectedStores (replacing store)
-- and photoUrls, but the validator was never updated, causing 400 errors on all sighting drafts.

begin;

create or replace function private.validate_draft_payload(
  p_draft_type text,
  p_payload jsonb
)
returns void
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  v_allowed text[];
  v_scope text;
  v_keys text[];
  v_key text;
begin
  if p_draft_type not in ('sighting', 'bounty')
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
  then
    raise exception 'Invalid contribution draft' using errcode = '22023';
  end if;

  if pg_column_size(p_payload) > 16384 then
    raise exception 'Contribution draft is too large' using errcode = '22023';
  end if;

  if p_draft_type = 'sighting' then
    v_allowed := array[
      'version', 'product', 'store', 'selectedStores', 'seenAt', 'availability',
      'quantity', 'notes', 'photoUrls',
      'productSuggestionName', 'storeSuggestionName'
    ];
  else
    v_allowed := array[
      'version', 'product', 'scope', 'store', 'zipCode', 'radiusMiles',
      'rewardAmount', 'deadline', 'requirements',
      'quantityNeeded', 'variantRequirements', 'acceptEquivalent',
      'selectedRetailers', 'selectedStores',
      'productSuggestionName', 'storeSuggestionName'
    ];
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_payload) key
    where not (key = any(v_allowed))
  ) then
    raise exception 'Contribution draft contains unsupported fields'
      using errcode = '22023', hint = 'DRAFT_UNSUPPORTED_FIELD';
  end if;

  if not (p_payload ? 'version')
    or jsonb_typeof(p_payload -> 'version') <> 'number'
  then
    raise exception 'Unsupported contribution draft version'
      using errcode = '22023', hint = 'DRAFT_UNSUPPORTED_VERSION';
  end if;

  if p_draft_type = 'sighting' then
    if (p_payload ->> 'version') not in ('1', '2') then
      raise exception 'Unsupported contribution draft version'
        using errcode = '22023', hint = 'DRAFT_UNSUPPORTED_VERSION';
    end if;
  else
    if (p_payload ->> 'version') <> '1' then
      raise exception 'Unsupported contribution draft version'
        using errcode = '22023', hint = 'DRAFT_UNSUPPORTED_VERSION';
    end if;
  end if;

  if p_payload ? 'notes' and char_length(coalesce(p_payload ->> 'notes', '')) > 2000 then
    raise exception 'Draft notes are too long' using errcode = '22023';
  end if;
  if p_payload ? 'requirements' and char_length(coalesce(p_payload ->> 'requirements', '')) > 2000 then
    raise exception 'Draft requirements are too long' using errcode = '22023';
  end if;

  -- Sighting-specific: validate photoUrls
  if p_draft_type = 'sighting' then
    if p_payload ? 'photoUrls' then
      declare v_photos jsonb := p_payload -> 'photoUrls'; begin
        if jsonb_typeof(v_photos) = 'array' and jsonb_array_length(v_photos) > 6 then
          raise exception 'Too many photos' using errcode = '22023';
        end if;
        if jsonb_typeof(v_photos) = 'array' then
          declare v_photo text; begin
            for v_photo in select jsonb_array_elements_text(v_photos)
            loop
              if char_length(v_photo) > 2048 then
                raise exception 'Photo URL is too long' using errcode = '22023';
              end if;
            end loop;
          end;
        end if;
      end;
    end if;
  end if;

  -- Bounty-specific validation
  if p_draft_type = 'bounty' then
    v_scope := p_payload ->> 'scope';
    if v_scope is not null and v_scope not in ('region', 'retailers', 'stores') then
      raise exception 'Invalid bounty scope' using errcode = '22023', hint = 'INVALID_SCOPE';
    end if;

    if p_payload ? 'zipCode' then
      declare v_zip text := p_payload ->> 'zipCode'; begin
        if v_zip is not null and v_zip !~ '^[0-9]{5}$' then
          raise exception 'Invalid ZIP code' using errcode = '22023', hint = 'INVALID_LOCATION';
        end if;
      end;
    end if;

    if p_payload ? 'radiusMiles' then
      declare v_radius text := p_payload ->> 'radiusMiles'; begin
        if v_radius is not null and v_radius ~ '^[0-9]+$'
          and v_radius::int not in (10, 25, 50, 100, 250)
        then
          raise exception 'Invalid radius' using errcode = '22023', hint = 'INVALID_LOCATION';
        end if;
      end;
    end if;

    if p_payload ? 'quantityNeeded' then
      declare v_qty text := p_payload ->> 'quantityNeeded'; begin
        if v_qty is not null and char_length(v_qty) > 3 then
          raise exception 'Quantity needed is too large' using errcode = '22023';
        end if;
      end;
    end if;

    if p_payload ? 'variantRequirements'
      and char_length(coalesce(p_payload ->> 'variantRequirements', '')) > 1000
    then
      raise exception 'Variant requirements are too long' using errcode = '22023';
    end if;

    if p_payload ? 'selectedRetailers' then
      declare v_arr jsonb := p_payload -> 'selectedRetailers'; begin
        if jsonb_typeof(v_arr) = 'array' and jsonb_array_length(v_arr) > 12 then
          raise exception 'Too many selected retailers' using errcode = '22023';
        end if;
      end;
    end if;

    if p_payload ? 'selectedStores' then
      declare v_arr jsonb := p_payload -> 'selectedStores'; begin
        if jsonb_typeof(v_arr) = 'array' and jsonb_array_length(v_arr) > 12 then
          raise exception 'Too many selected stores' using errcode = '22023';
        end if;
      end;
    end if;
  end if;
end;
$$;

commit;
