const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

export function ctaAssetNames(value) {
  if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? item : item?.name || item?.title).map(clean).filter(Boolean);
  const asset = value?.cta_asset;
  return asset?.exists && asset?.name ? [clean(asset.name)] : [];
}

export function applyCtaPolicy(script, { assets = [], fallbackCta = '' } = {}) {
  const names = ctaAssetNames(assets);
  const safe = { hook: clean(script?.hook), body: String(script?.body || '').trim(), cta: clean(script?.cta) };
  if (!names.length) return { ...safe, cta: '' };
  if (names.some(name => safe.cta.includes(name))) return safe;
  const configured = clean(fallbackCta);
  return {
    ...safe,
    cta: names.some(name => configured.includes(name))
      ? configured
      : `需要的话，我可以把我们的${names[0]}给你参考。`
  };
}

