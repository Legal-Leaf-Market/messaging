// The hand-checked part of the catalog: parts and service shops around Columbus, Indiana.
// Every row says where it came from and when. `verify: true` means the listing is thin, so
// call before relying on it. Being listed here means nothing about any relationship with us:
// these businesses are public listings, not partners, until one signs on as a store.
const D = '2026-11-05';
const TN_ANOD = 'https://www.thomasnet.com/suppliers/indiana/all-cities/anodizing-1790179';
const TN_POWDER = 'https://www.thomasnet.com/suppliers/indiana/all-cities/powder-coating-services-62441357';
const TN_HEAT = 'https://www.thomasnet.com/suppliers/indiana/all-cities/heat-treating-services-37380805';
const TN_ZINC = 'https://www.thomasnet.com/indiana/zinc-plating-61711008-1.html';
const JC = 'https://business.jacksoncochamber.com/list/ql/manufacturing-industry-16';
const MACH = 'https://machinist.com/machine-shops-in/indiana/columbus';
const EDC = 'https://www.columbusin.org/industry-targets/our-strengths/';

export const SUPPLIERS = [
  { id: 'quick-turn-anodizing', name: 'Quick Turn Anodizing', caps: ['anodizing', 'chem-film', 'welding'], city: 'Edinburgh',
    address: '6973 S US Highway 31, Edinburgh, IN 46124', phone: '(877) 716-1150', web: 'https://www.quickturnanodizing.net/index.html',
    hours: 'Monday to Thursday 8 AM to 5 PM, Friday 8 AM to 2 PM',
    note: 'Type I, II and III anodizing, chem film, passivation, black oxide. Stated lead times: Type II clear 1 day, color 2 days, Type III 2 to 3 days. Confirm before promising a date.',
    source: TN_ANOD, checked: D },
  { id: 'industrial-anodizing-washington', name: 'Industrial Anodizing Co.', caps: ['anodizing', 'chem-film', 'powder-coat'], city: 'Indianapolis',
    address: '1610 W Washington St, Indianapolis, IN', phone: '(317) 637-4641', web: 'https://www.industrialanodizing.com/',
    note: 'Anodizing, passivation, conversion coat, powder coat. Hoist line handles parts up to 11 feet.',
    source: 'https://www.industrialanodizing.com/services-and-capabilities', checked: D },
  { id: 'industrial-anodizing-webster', name: 'Industrial Anodizing Co., plating shop', caps: ['plating'], city: 'Indianapolis',
    address: '525 S Webster Ave, Indianapolis, IN 46219', phone: '(317) 637-4641', web: 'https://www.industrialanodizing.com/',
    note: 'Zinc plating and electropolish.', source: 'https://www.industrialanodizing.com/services-and-capabilities', checked: D },
  { id: 'superior-metal-technologies', name: 'Superior Metal Technologies', caps: ['anodizing', 'paint', 'fabrication'], city: 'Indianapolis',
    web: 'https://www.superiormetals.us/', note: 'Painting, anodizing, metal finishing and fabrication.', source: TN_ANOD, checked: D, verify: true },
  { id: 'keronite', name: 'Keronite', caps: ['anodizing'], city: 'Greenwood', web: 'https://www.keronite.com/',
    note: 'Plasma electrolytic oxidation, described as an alternative to anodizing.', source: TN_ANOD, checked: D, verify: true },
  { id: 'beacon-industries', name: 'Beacon Industries', caps: ['powder-coat', 'paint'], city: 'Edinburgh', web: 'https://beacon-industries.com/',
    note: 'Powder coating, abrasive blasting, painting, electrocoating, paint stripping.', source: TN_POWDER, checked: D, verify: true },
  { id: 'crane-hill-machine', name: 'Crane Hill Machine & Fabrication', caps: ['machining', 'fabrication', 'powder-coat', 'kitting-repack'], city: 'Seymour',
    address: '2476 E US Hwy 50, Seymour, IN 47274', phone: '(812) 358-3534', web: 'https://www.cranehillmachine.com/powder-coating/',
    note: 'Powder coating, design engineering, repair, remanufacturing and repackaging.', source: TN_POWDER, checked: D },
  { id: 'gammons-metal', name: 'Gammons Metal & Manufacturing', caps: ['fabrication', 'powder-coat'], city: 'Indianapolis', web: 'https://www.gammonsmetal.com/',
    note: 'Fabrication with powder coat prep and finishing.', source: TN_POWDER, checked: D, verify: true },
  { id: 'general-devices', name: 'General Devices Co.', caps: ['plating', 'powder-coat', 'paint'], city: 'Indianapolis', address: 'Indianapolis, IN 46239',
    web: 'https://www.generaldevices.com/about-us/capabilities', note: 'Zinc plating, wet paint and powder coat.', source: TN_ZINC, checked: D, verify: true },
  { id: 'procoat-products', name: 'ProCoat Products', caps: ['plating', 'powder-coat'], city: 'Madison', web: 'https://procoatproducts.com/zinc-plating/',
    note: 'Zinc plating in clear, yellow and black, barrel plating, powder coat, black oxide, electrocoat.', source: TN_ZINC, checked: D, verify: true },
  { id: 'elgin-fastener', name: 'Elgin Fastener Group', caps: ['fasteners', 'plating'], city: 'Versailles', web: 'https://elginfasteners.com/',
    note: 'Zinc plating and other metal finishing.', source: TN_ZINC, checked: D, verify: true },
  { id: 'electro-spec', name: 'Electro-Spec', caps: ['heat-treat', 'plating'], city: 'Franklin', web: 'https://www.electro-spec.com/blog/enhancing-your-product-with-heat-treating-and-annealing/',
    note: 'Annealing and heat treating for copper alloys, steels and nickel alloys.', source: TN_HEAT, checked: D, verify: true },
  { id: 'circle-city-heat-treating', name: 'Circle City Heat Treating', caps: ['heat-treat'], city: 'Indianapolis', web: 'https://www.circlecityheattreating.com/',
    note: 'Vacuum heat treating, tempering, annealing, carburizing, blasting, hardness testing.', source: TN_HEAT, checked: D, verify: true },
  { id: 'connecta-corp', name: 'Connecta Corp.', caps: ['heat-treat', 'machining'], city: 'Indianapolis', web: 'https://www.connecta.com/',
    note: 'Heat treating, CNC machining, passivation, brazing and assembly.', source: TN_HEAT, checked: D, verify: true },
  { id: 'quality-machine-tool-works', name: 'Quality Machine + Tool Works', caps: ['machining'], city: 'Columbus',
    address: '1201 Michigan Ave, Columbus, IN 47201', phone: '(812) 379-2660', web: 'https://qmtw.net/',
    note: 'CNC machining and finishing for trucking, diesel, automotive, power transmission and material handling.', source: 'https://qmtw.net/', checked: D },
  { id: 'liberty-advance-machine', name: 'Liberty Advance Machine', caps: ['machining'], city: 'Columbus', source: MACH, checked: D, verify: true, note: 'Directory listing only. Address not confirmed.' },
  { id: 'precise-tooling-solutions', name: 'Precise Tooling Solutions', caps: ['tooling'], city: 'Columbus', source: MACH, checked: D, verify: true, note: 'Directory listing only. Address not confirmed.' },
  { id: 'touchdown-machining', name: 'Touchdown Machining', caps: ['machining'], city: 'Columbus', source: MACH, checked: D, verify: true, note: 'Directory listing only. Address not confirmed.' },
  { id: 'turners-machining', name: "Turner's Machining Specialties", caps: ['machining'], city: 'Columbus', source: MACH, checked: D, verify: true, note: 'Directory listing only. Address not confirmed.' },
  { id: 'seymour-precision-machining', name: 'Seymour Precision Machining', caps: ['machining'], city: 'Seymour',
    address: '1733 First Ave, Seymour, IN 47274', phone: '(812) 524-1813', source: JC, checked: D },
  { id: 'fastenal-columbus', name: 'Fastenal', caps: ['fasteners', 'mro'], city: 'Columbus',
    address: '3993 N Long Rd, Columbus, IN 47203', phone: '(812) 378-4234', hours: 'Monday to Friday 9 AM to 3 PM', web: 'https://www.fastenal.com/locations/details/INCOL',
    source: 'https://www.fastenal.com/locations/details/INCOL', checked: D },
  { id: 'airgas-columbus', name: 'Airgas', caps: ['gases-welding-supply'], city: 'Columbus',
    address: '640 Behren Ct, Columbus, IN 47201', phone: '(812) 376-9961', hours: 'Monday to Friday 7:30 AM to 4:30 PM', web: 'https://locations.airgas.com/in/columbus/airgas-store-s229.html',
    note: 'We can pick up wire, tips, abrasives and safety gear. We do not carry gas cylinders.', source: 'https://locations.airgas.com/in/columbus/airgas-store-s229.html', checked: D },
  { id: 'linde-columbus', name: 'Linde Welding Gas & Equipment', caps: ['gases-welding-supply'], city: 'Columbus',
    address: '111 S National Rd, Columbus, IN 47201', phone: '(812) 376-3314', hours: 'Monday to Friday 8 AM to 3:30 PM', web: 'https://stores.lindedirect.com/in/columbus/industrial-supply-70615.html',
    note: 'We can pick up wire, rods, abrasives and safety gear. We do not carry gas cylinders.', source: 'https://stores.lindedirect.com/in/columbus/industrial-supply-70615.html', checked: D },
  // DSI is in catalog-additions.json with both its Columbus and Seymour sites.
  { id: 'pca-columbus-container', name: 'PCA Columbus Container', caps: ['packaging'], city: 'Columbus', note: 'Named among top local employers. Address not confirmed.', source: EDC, checked: D, verify: true },
];

// Capabilities for the Heart of Columbus "Makers & Industry" listings, by listing slug.
// These go by each listing's own type. Anything not named here stays in the full directory.
export const HOC_CAPS = {
  'boyer-machine-and-tool-co-inc': ['machining'], 'bettner-wire-coating-dies-inc': ['tooling'], 'capco-llc': ['machining'],
  'ce-systems': ['machining'], 'creative-tool-and-machining-inc': ['machining', 'tooling'], 'cunningham-pattern-and-engineering-inc': ['tooling'],
  'daileys-cnc-machining-llc': ['machining'], 'davids-inc': ['machining'], 'lear-machining-and-waterjet-inc': ['machining', 'waterjet-laser'],
  'noblitt-fabricating': ['fabrication'], 'precision-tools-service-inc': ['machining', 'tooling'], 'pyramid': ['machining'], 'tobar-inc': ['machining'],
  'master-power-transmission': ['bearings-pt'], 'the-parts-house-llc': ['mro'], 'grammer-logistics': ['warehouse-3pl'],
  'columbus-warehouse-and-cartage': ['warehouse-3pl'], 'analytical-engineering-inc': ['testing-calibration'], 'real-world-testing-inc': ['testing-calibration'],
  'columbus-industrial-electric': ['electrical'], 'kinney-paper-and-chemical-co': ['packaging'],
};

export const CAP_LABELS = {
  machining: 'Machine shops', tooling: 'Tool, die and pattern', fabrication: 'Fabrication', welding: 'Welding', 'waterjet-laser': 'Waterjet and laser',
  anodizing: 'Anodizing', 'chem-film': 'Chem film', plating: 'Plating', 'powder-coat': 'Powder coat', paint: 'Paint', 'heat-treat': 'Heat treat',
  fasteners: 'Fasteners', 'bearings-pt': 'Bearings and power transmission', mro: 'Industrial parts and MRO', hydraulics: 'Hydraulics', 'gases-welding-supply': 'Welding supply',
  electrical: 'Electrical', packaging: 'Packaging', 'kitting-repack': 'Kitting and repack', 'warehouse-3pl': 'Warehousing', 'testing-calibration': 'Testing',
};

// Rough road miles from Columbus, used only to suggest a price. Dispatch always sets the real quote.
export const AREA_MILES = {
  Columbus: 5, Edinburgh: 12, Taylorsville: 8, Hope: 12, Seymour: 20, Franklin: 22, Greenwood: 30, Shelbyville: 25, 'North Vernon': 25,
  Greensburg: 30, Indianapolis: 45, Madison: 45, Versailles: 40, Scottsburg: 40, Clarksville: 64, Jeffersonville: 65,
};
