const IFC_TYPE_TRANSLATIONS: Record<string, string> = {
  IFCPROJECT: 'Projekt',
  IFCSITE: 'Pozemek',
  IFCBUILDING: 'Budova',
  IFCBUILDINGSTOREY: 'Podlazi',
  IFCSPACE: 'Mistnost',
  IFCWALL: 'Stena',
  IFCWALLSTANDARDCASE: 'Stena',
  IFCCURTAINWALL: 'Prosklena stena',
  IFCSLAB: 'Deska',
  IFCROOF: 'Strecha',
  IFCCOLUMN: 'Sloup',
  IFCBEAM: 'Nosnik',
  IFCSTAIR: 'Schodiste',
  IFCSTAIRFLIGHT: 'Rameno schodiste',
  IFCRAILING: 'Zabradli',
  IFCDOOR: 'Dvere',
  IFCWINDOW: 'Okno',
  IFCOPENINGELEMENT: 'Otvor',
  IFCCOVERING: 'Povrch',
  IFCPLATE: 'Deska',
  IFCFURNITURE: 'Nabytek',
  IFCFURNISHINGELEMENT: 'Nabytek',
  IFCSYSTEMFURNITUREELEMENT: 'Nabytek',
  IFCANNOTATION: 'Anotace',
  CUSTOM: 'Vlastni'
}

const normalizeIfcTypeKey = (type?: string): string => (type ?? '').replace(/[\s_-]+/g, '').toUpperCase()

export const localizeIfcType = (type?: string): string => {
  const key = normalizeIfcTypeKey(type)
  if (!key) return 'Neznamy'
  return IFC_TYPE_TRANSLATIONS[key] ?? key
}
