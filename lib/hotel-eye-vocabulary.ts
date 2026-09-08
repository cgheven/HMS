// Auto-generated from the HotelEye portal's own dropdown vocabulary
// (hotel_eye_integration/auth_session/artifacts/form_vocabulary.json).
// These are the EXACT values the portal accepts — the admission form must
// store one of these, never free text, or a sync is rejected.

export const HOTEL_EYE_PROVINCES: readonly string[] = [
  "Azad Kashmir",
  "Balochistan",
  "F.A.T.A",
  "Gilgit Baltistan",
  "Islamabad",
  "Khyber Pakhtunkhwa",
  "Name Unknown",
  "Other",
  "Punjab",
  "Sindh",
];

export const HOTEL_EYE_DISTRICTS: Readonly<Record<string, readonly string[]>> = {
  "Azad Kashmir": ["Bagh", "Bhimber", "Hattian", "Haveli", "Kotli", "Mirpur", "Muzaffarabad", "Neelum", "Poonch", "Sudhnoti"],
  "Balochistan": ["Awaran", "Barkhan", "Bolan", "Chagai", "Dera Bugti", "Gwadar", "Harnai", "Jaffarabad", "Jhal Magsi", "Kalat", "Kech", "Kharan", "Khuzdar", "Killa Abdullah", "Killa Saifullah", "Kohlu", "Lasbela", "Loralai", "Mastung", "Musakhel", "Nasirabad", "Nushki", "Panjgur", "Panjpai", "Pishin", "Quetta", "Sherani", "Sibi", "Zhob", "Ziarat", "Lehri", "Sohbatpur"],
  "F.A.T.A": ["Bajaur Agency", "FR Bannu", "FR D.I.Khan", "FR Kohat", "FR Lakki Marwat", "FR Peshawar", "FR Tank", "Khyber Agency", "Kurram Agency", "Mohmand Agency", "North Waziristan Agency", "Orakzai Agency", "South Waziristan Agency"],
  "Gilgit Baltistan": ["Astore", "Baltistan", "Diamir", "Ghanche", "Ghizer", "Gilgit", "Hunza Nagar"],
  "Islamabad": ["Islamabad"],
  "Khyber Pakhtunkhwa": ["Abbottabad", "Bannu", "Batagram", "Buner", "Charsadda", "Chitral", "D. I. Khan", "Hangu", "Haripur", "Karak", "Kohat", "Kohistan", "Lakki Marwat", "Lower Dir", "Malakand PA", "Mansehra", "Mardan", "Nowshera", "Peshawar", "Shangla", "Swabi", "Swat", "Tank", "Upper Dir", "Tor Ghar", "Lower Kohistan"],
  "Name Unknown": ["Name Unknown"],
  "Other": ["Other"],
  "Punjab": ["Faisalabad", "Gujranwala", "Multan", "Rawalpindi", "Attock", "Bahawalnagar", "Bahawalpur", "Bhakkar", "Chakwal", "Chiniot", "DERA GHAZI KHAN", "Gujrat", "Hafizabad", "Jhang", "Jhelum", "Kasur", "Khanewal", "Khushab", "Layyah", "Lodhran", "M.B.Din", "Mianwali", "Muzaffargarh", "Nankana", "Narowal", "Okara", "Pakpattan", "R.Y.Khan", "Rajanpur", "Sahiwal", "Sargodha", "Sheikhupura", "Sialkot", "T.T.Singh", "Vehari", "Lahore", "Kot Addu", "Taunsa", "Talagang", "Murree", "Wazirabad"],
  "Sindh": ["Badin", "Dadu", "Ghotki", "Hyderabad", "Jacobabad", "Jamshoro", "Karachi", "Kashmore", "Khairpur", "Larkana", "Matiari", "Mirpur Khas", "Naushahro Feroze", "Nawabshah", "Qambar Shahdadkot", "Sanghar", "Shikarpur", "Sukkur", "Tando Allah Yar", "Tando Muhammad Khan", "Tharparkar", "Thatta", "Umer Kot", "Sujawal"],
};

// Guests filed per server call: each call stays well inside the serverless time
// limit, and the queue is walked in chunks of this size with a small pause
// between portal writes. Also a hard per-call ceiling. Lives here (a plain
// module) rather than the "use server" actions file, which may export only
// async functions.
export const HOTEL_EYE_CHUNK_MAX = 10;
