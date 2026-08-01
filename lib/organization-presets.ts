// Employer name suggestions for the Professional "Organization" field, split by
// Organization Type. The type is picked first on every form (see the Type →
// Organization ordering), so by the time this field is reached the right list
// is already known.
//
// Same contract as the department and institute lists: plain text is what gets
// stored, so these are a browsing convenience with an "Other (specify)" escape
// hatch — never a constraint. Anything missing can still be typed.
//
// Grouped by sector rather than alphabetised: the field is searchable, so
// grouping only affects browsing, and keeping sectors together makes the list
// far easier to extend without creating duplicates.

export const PRIVATE_ORGANIZATION_PRESETS: string[] = [
  // ── Banks ──────────────────────────────────────────────────────────────
  "HBL (Habib Bank)", "UBL (United Bank)", "MCB Bank", "Allied Bank",
  "Bank Alfalah", "Meezan Bank", "Faysal Bank", "Askari Bank", "JS Bank",
  "Soneri Bank", "Standard Chartered", "Habib Metropolitan Bank",
  "Bank Al Habib", "Dubai Islamic Bank", "BankIslami", "Al Baraka Bank",
  "MCB Islamic Bank", "Summit Bank", "Silkbank", "Samba Bank",
  "First Women Bank", "Citibank Pakistan", "Deutsche Bank Pakistan",
  "Bank of Punjab", "Bank of Khyber", "Sindh Bank",
  // Microfinance & DFIs
  "Khushhali Microfinance Bank", "Mobilink Microfinance Bank",
  "U Microfinance Bank", "FINCA Microfinance Bank", "Telenor Microfinance",
  "NRSP Microfinance Bank", "Apna Microfinance Bank", "Advans Pakistan",
  "Pak Oman Investment", "Pak Brunei Investment", "Pak Kuwait Investment",
  "Saudi Pak Investment",
  // Fintech & payments
  "EasyPaisa", "JazzCash", "SadaPay", "NayaPay", "Finja", "1LINK", "NIFT",

  // ── Insurance ──────────────────────────────────────────────────────────
  "Jubilee Life Insurance", "EFU Life Assurance", "EFU General Insurance",
  "Adamjee Insurance", "Jubilee General Insurance", "IGI Insurance",
  "TPL Insurance", "Askari General Insurance", "Atlas Insurance",
  "Alfalah Insurance", "UBL Insurers", "Habib Insurance",
  "Pak Qatar Takaful", "Salaam Takaful",

  // ── Telecom & Internet ─────────────────────────────────────────────────
  "Jazz", "Telenor Pakistan", "Zong (CMPak)", "Ufone", "PTCL",
  "Nayatel", "StormFiber (Cybernet)", "Transworld", "Wateen Telecom",
  "Multinet", "Worldcall", "Optix", "Connect Communications",

  // ── IT & Software ──────────────────────────────────────────────────────
  "Systems Limited", "NetSol Technologies", "Contour Software", "Devsinc",
  "Arbisoft", "10Pearls", "Techlogix", "TRG Pakistan", "Ibex",
  "S&P Global", "Siemens EDA (Mentor Graphics)", "Confiz", "VentureDive",
  "Folio3", "Xavor", "Emumba", "Tkxel", "Gaditek", "Nextbridge",
  "Avanza Solutions", "Sybrid", "i2c Inc", "Motive (KeepTruckin)",
  "InvoZone", "Cubix", "Bramerz", "Datics", "Genetech Solutions",
  "Kalsoft", "LMKR", "Trillium Information Security", "Salsoft",
  "Netsol Innovation", "Abacus Consulting", "Mindbridge", "Touchstone",
  "Digitrends", "Softech Worldwide", "Ephlux", "ArhamSoft",

  // ── E-commerce & Startups ──────────────────────────────────────────────
  "Daraz", "Foodpanda", "Careem", "Bykea", "Airlift", "Bazaar Technologies",
  "Retailo", "Krave Mart", "Cheetay", "PriceOye", "Zameen.com", "Rozee.pk",
  "OLX Pakistan", "Sastaticket", "Bookme.pk", "Tazah", "Dastgyr",
  "Sehat Kahani", "Oladoc", "Mathmagic", "Educative",

  // ── FMCG & Food Manufacturing ──────────────────────────────────────────
  "Nestlé Pakistan", "Unilever Pakistan", "Procter & Gamble Pakistan",
  "Coca-Cola Pakistan", "PepsiCo Pakistan", "Colgate-Palmolive Pakistan",
  "Reckitt Benckiser Pakistan", "FrieslandCampina Engro", "National Foods",
  "Shan Foods", "Mitchell's Fruit Farms", "Ismail Industries (Candyland)",
  "Continental Biscuits (LU)", "English Biscuit Manufacturers (Peek Freans)",
  "Hilal Confectionery", "Tapal Tea", "Dalda Foods", "Habib Oil Mills",
  "Fauji Foods", "Haleeb Foods", "Shakarganj Foods", "K&N's Foods",
  "Sabroso", "Youngs Food", "Rafhan (Ingredion)", "Popular Foods",
  "Murree Brewery", "Matco Foods", "Unity Foods", "Fatima Feeds",

  // ── Textile & Apparel Manufacturing ────────────────────────────────────
  "Interloop", "Nishat Mills", "Nishat Chunian", "Sapphire Textile",
  "Gul Ahmed Textile", "Kohinoor Textile", "Masood Textile", "US Apparel",
  "Artistic Milliners", "Soorty Enterprises", "Denim Clothing Company",
  "Crescent Textile", "Chenab Group", "Sitara Textile", "Fazal Cloth",
  "Indus Dyeing", "Alkaram Textile", "Style Textile", "Rajby Industries",
  "Shafi Texcel", "Kamal Textile", "Feroze1888",

  // ── Retail Fashion Brands ──────────────────────────────────────────────
  "Khaadi", "Sana Safinaz", "J. (Junaid Jamshed)", "Bareeze (Sefam)",
  "Alkaram Studio", "Nishat Linen", "Sapphire Retail", "Limelight",
  "Outfitters", "Breakout", "Generation", "Zellbury", "Ideas by Gul Ahmed",
  "Bonanza Satrangi", "Ethnic by Outfitters", "Diners", "Uniworth",
  "Cambridge Shop", "Servis Shoes", "Bata Pakistan", "Stylo Shoes",
  "Borjan", "Ndure", "ChenOne", "Hush Puppies Pakistan",

  // ── Cement, Steel & Building Materials ─────────────────────────────────
  "Lucky Cement", "DG Khan Cement", "Maple Leaf Cement", "Bestway Cement",
  "Fauji Cement", "Attock Cement", "Pioneer Cement", "Kohat Cement",
  "Cherat Cement", "Power Cement", "Gharibwal Cement", "Thatta Cement",
  "Amreli Steels", "Mughal Steel", "Agha Steel", "International Steels",
  "International Industries", "Aisha Steel", "Crescent Steel",
  "Tuwairqi Steel", "Master Tiles", "Sonex", "Sanitary Wares",

  // ── Automobile & Engineering ───────────────────────────────────────────
  "Indus Motor (Toyota)", "Honda Atlas Cars", "Pak Suzuki Motor",
  "Millat Tractors", "Al-Ghazi Tractors", "Hinopak Motors",
  "Master Motors", "Ghandhara Nissan", "Ghandhara Industries",
  "Atlas Honda", "Yamaha Motor Pakistan", "United Motors", "Road Prince",
  "Super Power", "Sazgar Engineering", "KIA Lucky Motors",
  "Hyundai Nishat Motor", "MG Pakistan", "Changan Master Motors",
  "Regal Automobile", "Dewan Motors", "Thal Limited", "Agriauto Industries",
  "Exide Pakistan", "Atlas Battery", "Loads Limited", "Panther Tyres",
  "General Tyre", "Service Industries",

  // ── Pharmaceuticals ────────────────────────────────────────────────────
  "Getz Pharma", "GSK Pakistan", "Searle Pakistan", "Ferozsons Laboratories",
  "Martin Dow", "Hilton Pharma", "Sami Pharmaceuticals",
  "Highnoon Laboratories", "Abbott Pakistan", "Pfizer Pakistan",
  "Sanofi Aventis Pakistan", "Novartis Pakistan", "Bayer Pakistan",
  "Roche Pakistan", "AGP Limited", "Bosch Pharmaceuticals", "PharmEvo",
  "Barrett Hodgson", "Genix Pharma", "Nabiqasim Industries",
  "Atco Laboratories", "Macter International", "Shaigan Pharmaceuticals",
  "CCL Pharmaceuticals", "Wilshire Laboratories", "Werrick Pharmaceuticals",
  "Tabros Pharma", "Helix Pharma", "Platinum Pharmaceuticals",

  // ── Hospitals, Labs & Healthcare ───────────────────────────────────────
  "Shaukat Khanum Memorial Hospital", "Aga Khan University Hospital",
  "Indus Hospital", "Liaquat National Hospital", "Doctors Hospital",
  "Hameed Latif Hospital", "Evercare Hospital", "Shifa International",
  "Ittefaq Hospital", "Farooq Hospital", "National Hospital",
  "Omar Hospital", "Surgimed Hospital", "Maroof International Hospital",
  "Kulsum International Hospital", "Quaid-e-Azam International Hospital",
  "Ziauddin Hospital", "South City Hospital", "Patel Hospital",
  "Tabba Heart Institute", "Chughtai Lab", "Islamabad Diagnostic Centre",
  "Excel Labs", "Shaukat Khanum Lab", "Alnoor Diagnostic Centre",
  "Agha Khan Lab",

  // ── Energy, Oil, Gas & Power ───────────────────────────────────────────
  "Shell Pakistan", "Total Parco", "Attock Petroleum", "Hascol Petroleum",
  "Cnergyico (Byco)", "Gas & Oil Pakistan (GO)", "Puma Energy Pakistan",
  "Attock Refinery", "National Refinery", "Pakistan Refinery (PRL)",
  "Hub Power Company (HUBCO)", "K-Electric", "Nishat Power",
  "Kohinoor Energy", "Lalpir Power", "Saif Power", "Sapphire Electric",
  "Engro Powergen", "Atlas Power", "Liberty Power", "Altern Energy",
  "Attock Gen", "Arif Habib Power",

  // ── Chemicals, Fertilizer & Paints ─────────────────────────────────────
  "Engro Corporation", "Engro Fertilizers", "Engro Polymer",
  "Fauji Fertilizer (FFC)", "Fauji Fertilizer Bin Qasim", "Fatima Fertilizer",
  "Agritech Limited", "Pak Arab Fertilizers", "ICI Pakistan",
  "Lotte Chemical Pakistan", "Sitara Chemical", "Descon Oxychem",
  "Archroma Pakistan", "BASF Pakistan", "Berger Paints", "Diamond Paints",
  "Nippon Paint Pakistan", "Brighto Paints", "AkzoNobel (Dulux)",
  "Master Paints", "Buxly Paints", "Happilac Paints",

  // ── Media & Advertising ────────────────────────────────────────────────
  "Geo TV", "ARY Digital", "Hum TV", "Dunya News", "Samaa TV",
  "Express News", "92 News", "Bol News", "Aaj TV", "Neo TV", "City 42",
  "Jang Group", "Dawn Media Group", "Express Media Group",
  "Nawa-i-Waqt Group", "Business Recorder", "Pakistan Today",
  "Ogilvy Pakistan", "JWT Pakistan", "Adcom Leo Burnett", "Synergy Group",

  // ── Education (as employers) ───────────────────────────────────────────
  "Beaconhouse School System", "The City School", "Lahore Grammar School",
  "Roots International", "Roots Millennium", "Bloomfield Hall",
  "Froebel's International", "The Educators", "Allied School",
  "Dar-e-Arqam Schools", "American Lycetuff", "Headstart School",
  "Punjab Group of Colleges", "Superior Group of Colleges",
  "Unique Group of Institutions", "KIPS Education System",
  "LUMS", "IBA Karachi", "FAST-NUCES", "COMSATS University",
  "University of Management & Technology (UMT)",
  "University of Central Punjab (UCP)", "Riphah International University",
  "Iqra University", "SZABIST", "Habib University", "IoBM",
  "Bahria University", "Air University", "Lahore School of Economics",

  // ── Logistics & Courier ────────────────────────────────────────────────
  "TCS", "Leopards Courier", "M&P (Muller & Phipps)", "BlueEx", "Trax",
  "CallCourier", "Rider", "DHL Pakistan", "FedEx Pakistan",
  "Daewoo Express", "Faisal Movers", "Skyways", "Niazi Express",
  "Bilal Travels", "Agility Logistics", "Maersk Pakistan",

  // ── Airlines & Travel ──────────────────────────────────────────────────
  "Airblue", "SereneAir", "AirSial", "Fly Jinnah", "Gerry's dnata",
  "Emirates Pakistan", "Qatar Airways Pakistan", "Saudia Pakistan",

  // ── Retail & Supermarkets ──────────────────────────────────────────────
  "Imtiaz Super Market", "Al-Fatah", "Metro Cash & Carry",
  "Carrefour Pakistan", "Hyperstar", "Chase Up", "Naheed Supermarket",
  "Green Valley", "Jalal Sons", "Springs", "Euromart", "Madina Cash & Carry",

  // ── Food Chains & Hospitality ──────────────────────────────────────────
  "McDonald's Pakistan", "KFC Pakistan", "Pizza Hut Pakistan",
  "Hardee's Pakistan", "Burger King Pakistan", "Subway Pakistan",
  "Domino's Pizza Pakistan", "Gloria Jean's Coffees", "Second Cup",
  "Tim Hortons Pakistan", "Chaaye Khana", "Espresso", "Cinnabon Pakistan",
  "Baskin Robbins Pakistan", "Student Biryani", "Bundu Khan",
  "Salt'n Pepper", "BBQ Tonight", "Kolachi", "Monal Restaurant",
  "Howdy", "Johnny Rockets Pakistan", "Cafe Aylanto",
  "Pearl Continental (PC Hotel)", "Serena Hotels", "Avari Hotels",
  "Marriott Hotel Pakistan", "Movenpick Karachi", "Nishat Hotel",
  "Ramada Pakistan", "Hashoo Group",

  // ── Real Estate & Developers ───────────────────────────────────────────
  "Bahria Town", "Emaar Pakistan", "Zameen Developments",
  "Capital Smart City", "Lake City", "Park View City",
  "Blue World City", "Eighteen Islamabad", "Al-Ghurair Giga",
  "Habib Construction Services", "Izhar Group", "Saif Group",

  // ── Conglomerates, Engineering & Services ──────────────────────────────
  "Packages Limited", "Nishat Group", "Dawood Hercules", "House of Habib",
  "Lakson Group", "Yunus Brothers (YB Group)", "Arif Habib Group",
  "JS Group", "Atlas Group", "Bibojee Group", "Crescent Group",
  "Sapphire Group", "Sitara Group", "Descon Engineering",
  "Associated Consulting Engineers (ACE)", "NESPAK", "Siemens Pakistan",
  "ABB Pakistan", "Schneider Electric Pakistan", "Honeywell Pakistan",
  "Philip Morris Pakistan", "Pakistan Tobacco Company",
  "A.F. Ferguson (PwC)", "KPMG Pakistan", "EY Ford Rhodes",
  "Deloitte Pakistan", "Grant Thornton Pakistan",
];

export const GOVERNMENT_ORGANIZATION_PRESETS: string[] = [
  // ── Power & Utilities ──────────────────────────────────────────────────
  "WAPDA", "NTDC", "LESCO", "GEPCO", "FESCO", "MEPCO", "IESCO", "PESCO",
  "HESCO", "SEPCO", "QESCO", "TESCO", "SNGPL (Sui Northern Gas)",
  "SSGC (Sui Southern Gas)", "WASA", "Water Board", "PEPCO", "CPPA-G",

  // ── Oil, Gas, Minerals & Energy ────────────────────────────────────────
  "PSO (Pakistan State Oil)", "OGDCL", "PPL (Pakistan Petroleum)",
  "GHPL", "SNGC", "PAEC (Atomic Energy)", "AEDB", "PPIB", "NEPRA", "OGRA",

  // ── Federal Departments & Authorities ──────────────────────────────────
  "NADRA", "FBR (Federal Board of Revenue)", "Customs Department",
  "Excise & Taxation", "State Bank of Pakistan", "National Bank of Pakistan",
  "Zarai Taraqiati Bank (ZTBL)", "SME Bank", "Pakistan Post",
  "Pakistan Railways", "PIA", "PTCL (Govt Holding)", "Pakistan Bait-ul-Mal",
  "Benazir Income Support Programme (BISP)", "Ehsaas Programme",
  "Civil Aviation Authority", "Airport Security Force (ASF)",
  "NHA (National Highway Authority)", "National Highways & Motorway Police",
  "NLC (National Logistics Cell)", "FWO (Frontier Works Organization)",
  "NAB (National Accountability Bureau)", "FIA", "ANF (Anti-Narcotics Force)",
  "Anti-Corruption Establishment", "Election Commission of Pakistan",
  "Auditor General of Pakistan", "Planning Commission", "PBS (Bureau of Statistics)",
  "SECP", "Competition Commission of Pakistan", "PTA", "PEMRA",
  "Pakistan Standards (PSQCA)", "Pakistan Council of Scientific Research",
  "PARC (Agricultural Research)", "SUPARCO", "NIH (National Institute of Health)",
  "DRAP (Drug Regulatory Authority)", "HEC (Higher Education Commission)",
  "Pakistan Engineering Council", "PMDC / PMC", "Pakistan Bar Council",
  "Pakistan Meteorological Department", "Survey of Pakistan",
  "Pakistan Ordnance Factories (POF)", "Heavy Industries Taxila",
  "Pakistan Aeronautical Complex (PAC)", "KRL (Khan Research Labs)",
  "NESCOM", "NRTC", "Utility Stores Corporation", "TCP (Trading Corporation)",
  "PASSCO", "Pakistan Steel Mills", "Port Qasim Authority",
  "Karachi Port Trust", "Gwadar Port Authority", "Pakistan Navy Dockyard",

  // ── Provincial & Local Government ──────────────────────────────────────
  "Government of Punjab", "Government of Sindh",
  "Government of Khyber Pakhtunkhwa", "Government of Balochistan",
  "Gilgit-Baltistan Government", "AJK Government",
  "District Administration", "Deputy Commissioner Office",
  "Municipal Corporation", "Local Government Department",
  "Health Department", "Education Department", "School Education Department",
  "Higher Education Department", "Agriculture Department",
  "Livestock Department", "Irrigation Department",
  "Communication & Works (C&W)", "Public Health Engineering",
  "Forest Department", "Revenue Department", "Board of Revenue",
  "Population Welfare Department", "Social Welfare Department",
  "Labour Department", "Industries Department", "Food Department",
  "Cooperatives Department", "Environment Protection Department",
  "Sports Board", "Auqaf Department", "Zakat & Ushr Department",
  "LDA (Lahore Development Authority)", "CDA (Capital Development Authority)",
  "KDA / KMC", "RDA", "FDA (Faisalabad Development Authority)",
  "PHA (Parks & Horticulture Authority)", "Punjab Safe Cities Authority",
  "Punjab Information Technology Board (PITB)",

  // ── Armed Forces, Police & Law ─────────────────────────────────────────
  "Pakistan Army", "Pakistan Navy", "Pakistan Air Force",
  "Punjab Police", "Sindh Police", "KP Police", "Balochistan Police",
  "Islamabad Capital Police", "Motorway Police", "Rangers",
  "Frontier Corps (FC)", "Levies", "Traffic Police", "Elite Force",
  "Counter Terrorism Department (CTD)", "Special Branch",
  "Judiciary / Courts", "District Courts", "High Court", "Supreme Court",
  "Prosecution Department", "Prisons Department", "Rescue 1122",
  "Civil Defence", "Fire Brigade",

  // ── Public Health & Education ──────────────────────────────────────────
  "Government Hospital", "DHQ Hospital", "THQ Hospital",
  "Basic Health Unit (BHU)", "Rural Health Centre (RHC)",
  "Mayo Hospital", "Jinnah Hospital", "Services Hospital",
  "Ganga Ram Hospital", "Nishtar Hospital", "Allied Hospital",
  "Lady Reading Hospital", "Civil Hospital Karachi", "JPMC",
  "PIMS Islamabad", "Sheikh Zayed Hospital", "Children's Hospital",
  "Punjab Institute of Cardiology", "Government College / University",
  "Public School (Govt)", "Government Degree College",
  "University of the Punjab", "University of Karachi", "UET Lahore",
  "NUST", "Quaid-i-Azam University", "King Edward Medical University",
  "Allama Iqbal Open University", "Virtual University",
];

/** Which employer list matches the chosen Organization Type. Returns an empty
 *  array when no type has been picked yet — callers fall back to a plain text
 *  input rather than guessing which vocabulary applies. */
export function organizationPresetsFor(orgType: string | null | undefined): string[] {
  if (orgType === "private") return PRIVATE_ORGANIZATION_PRESETS;
  if (orgType === "government") return GOVERNMENT_ORGANIZATION_PRESETS;
  return [];
}
