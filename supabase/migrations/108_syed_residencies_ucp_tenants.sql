-- Onboarding: Syed Residencies Boys Hostel UCP — tenant intake (48 forms)
-- Source: tenant_intake_review.xlsx (WhatsApp/paper intake, OCR-assisted review)
-- 35 rows have confirmed room + rent + security; 13 rows have unresolved room
-- and/or missing rent/security — inserted anyway per owner instruction, flagged
-- in the notes column (room_id left NULL, monthly_rent/security_deposit default
-- to 0) for the owner to complete via the Tenants page.
-- package_tier = space_food_ac for all (every room is AC); check_in = today
-- (no move-in dates existed in source data). food_monthly_rate is 0 for this
-- hostel so food charges are unaffected by tier choice.

INSERT INTO hms_tenants (
  hostel_id, room_id, full_name, phone, cnic, type, check_in,
  monthly_rent, security_deposit, package_tier, billing_type,
  emergency_contact, emergency_phone, emergency_relationship, notes
)
SELECT
  '1ed0450f-99e5-4e24-a9b3-6dda70bcc35b'::uuid,
  r.id,
  v.full_name, v.phone, v.cnic, 'general', CURRENT_DATE,
  v.monthly_rent, v.security_deposit, 'space_food_ac', 'monthly',
  v.emergency_contact, v.emergency_phone,
  CASE WHEN v.emergency_contact IS NOT NULL THEN 'Father' ELSE NULL END,
  v.notes
FROM (VALUES
    ('301', 'Muhammad Sabih-ur-Rehman', '0303-4511600', '31205-5382168-1', 26000, 10000, 'Hafiz Muhammad Shafiq', '0317-7155752', 'Form WA0075 | Occupation: Imam Masjid | Room type marked: single | Low-confidence name reading — verify against original form | Intake flags: low-confidence name; low-confidence address'),
    ('303', 'Faisal Manzoor', NULL, '35202-4402132-3', 40600, 26000, 'Manzoor Ahmed', '0309-4408876', 'Form WA0076 | Occupation: Job Holder | Room type marked: three-seater | Intake flags: own mobile blank; rent unclear (40,600 or 40,000); photo is a passport, not CNIC'),
    ('302', 'Sami Ullah', '0301-6715023', '38403-8504656-7', 17000, 13000, 'Aman Ullah', '0306-6043054', 'Form WA0077 | Occupation: Tailor (Darzi) | Room type marked: three-seater | Intake flags: address cut off; ID photo unreadable (glare)'),
    (NULL, 'Malik Rabi Tawfiq', '0321-7990721', '35103-5764744-3', 22000, 10000, 'Haji Malik Tawfiq', '0303-4250465', 'Form WA0078 | Occupation: Business | Room type marked: single + three-seater (both checked) | Unconfirmed room (source: "109 or 202") — assign manually | Low-confidence name reading — verify against original form | Intake flags: room digit itself ambiguous (09 vs 25); address obscured by ink stain; both seater boxes checked'),
    ('304', 'Saad Sultan', '0300-9431840', '35404-6433240-1', 0, 10000, 'Sultan Dawood Akhtar', '0312-9431840', 'Form WA0079 | Occupation: Retired Worker | Room type marked: three-seater | Low-confidence name reading — verify against original form | Rent not recorded — needs owner input | Intake flags: rent left blank'),
    ('302', 'Muhammad Shehryar', '0300-6098020', '38303-7116301-1', 17000, 13000, 'Muhammad Iqbal', '0305-7111924', 'Form WA0080 | Occupation: Government Officer | Room type marked: three-seater | Intake flags: form reads 301 (single) but formula + checkbox both say 302 - recheck original'),
    ('205', 'M. Abbas', NULL, '36103-1838427-3', 17000, 13000, 'M. Ilyas', '0308-7101117', 'Form WA0081 | Room type marked: three-seater | Low-confidence name reading — verify against original form | Intake flags: own mobile & blood group blank; ID photo mirrored/unreadable'),
    ('206', 'Muhammad Ali Mohsin Yar', '0324-7644443', '32309-2137963-3', 24000, 19000, 'Mohsin Yar Ahmad', '0335-6868490', 'Form WA0082 | Room type marked: single | Low-confidence name reading — verify against original form | Intake flags: room206 predicted 3-seater but checkbox says single (systemic pattern)'),
    ('204', 'Usama Yaseen', '0324-8767628', '32402-1588149-1', 24000, 10020, 'M. Yaseen', '0332-1922020', 'Form WA0083 | Occupation: Shop | Room type marked: three-seater'),
    ('202', 'Muhammad Aslam', '0311-6461146', '33202-6309714', 24000, 0, 'Shahid Aftab', '0305-5958120', 'Form WA0084 | Occupation: Job holder | Room type marked: three-seater | Security deposit not recorded — needs owner input | Intake flags: security blank; CNIC only 12 digits, may be missing one'),
    ('101', 'Areeb Javed', '0335-5311400', '13301-1587770-9', 26000, 10000, 'Arshad Javed', '0300-9811412', 'Form WA0085 | Room type marked: single | Intake flags: formula boundary case matches exactly (101 is the only single-seater on this floor)'),
    ('208', 'Amr Shaheer', '0319-5539613', '33103-9439709', 0, 0, 'Shahid Saleem', '0332-7040875', 'Form WA0086 | Occupation: Motorway Police | Room type marked: single | Rent not recorded — needs owner input | Security deposit not recorded — needs owner input | Intake flags: rent & security blank; CNIC only 12 digits; room number corrected on form; part of room-208 overcapacity issue'),
    ('206', 'Aun Abbas', '0316-7339093', '34301-7501677-1', 25000, 10000, 'Muzaffar Hayat', '0345-0961709', 'Form WA0087 | Occupation: Farmer | Room type marked: three-seater | Intake flags: institute/address low-confidence cursive'),
    ('103', 'Ahmad Raza Mustafavi', '0309-1570231', '34201-4777656-3', 22000, 10000, 'Muhammad Tariq', NULL, 'Form WA0088 | Occupation: Engineer | Room type marked: three-seater | Intake flags: father''s mobile blank; rent value was corrected on the form'),
    ('204', 'Tayyab Asif', '0340-8862997', '81101-8305963-1', 24000, 10000, 'M. Asif', '0309-5875890', 'Form WA0089 | Occupation: Abroad | Room type marked: three-seater'),
    ('103', 'Syed Hamza Al-Hasan', '0316-9195471', '71501-5080940-3', 24000, 0, 'Syed Abul Hasan', '0314-4451207', 'Form WA0090 | Room type marked: three-seater | Security deposit not recorded — needs owner input | Intake flags: security blank; room103 now at exactly capacity 3 (WA0088, WA0090, WA0115)'),
    ('304', 'Shayan Ahmad', '0325-6673834', '35404-5351381-9', 0, 0, 'Basharat Ali', '0302-4636226', 'Form WA0091 | Occupation: Shopkeeper | Room type marked: three-seater | Rent not recorded — needs owner input | Security deposit not recorded — needs owner input | Intake flags: rent & security blank'),
    ('205', 'Haji Kabir Ahmad Khan', '0300-0308689', '38302-7533157-5', 24000, 13000, 'Abdul Haq', '0346-5515809', 'Form WA0092 | Occupation: Job - MLCF (Maple Leaf Cement) | Room type marked: three-seater | Low-confidence name reading — verify against original form | Intake flags: names in dense cursive, best-effort read'),
    ('208', 'Muhammad Subhan Khan', '0320-7869297', '81202-4140811-9', 0, 0, 'Ehsan Khan', '0303-8094400', 'Form WA0093 | Occupation: Captain (Retd) | Room type marked: three-seater | Rent not recorded — needs owner input | Security deposit not recorded — needs owner input | Intake flags: rent & security blank; CNIC verified against clipped ID card, exact match; part of room-208 overcapacity issue'),
    ('104', 'Yousaf Ali Raza', '0301-7120434', '35503-0197530-7', 24000, 10000, 'Ahmad Raza', '0302-1374448', 'Form WA0094 | Room type marked: three-seater | Intake flags: room104 now at exactly capacity 3 (WA0094, WA0117, WA0121)'),
    ('203', 'Mohsinain Tanveer', '0321-7835881', '33102-3677822-3', 0, 0, 'Tahir Abbas', '0301-3335881', 'Form WA0095 | Occupation: Private Job | Room type marked: single | Rent not recorded — needs owner input | Security deposit not recorded — needs owner input | Intake flags: rent & security blank; room203 predicted 3-seater but marked single'),
    ('105', 'Khalid Naeem', '0302-6985929', '31109-9001958-3', 0, 0, 'Naeem', '0300-9165626', 'Form WA0096 | Occupation: Agriculture | Room type marked: three-seater | Rent not recorded — needs owner input | Security deposit not recorded — needs owner input | Intake flags: rent & security blank; near-identical address to WA0099, possibly related tenants'),
    ('209', 'Saad Aslam', '0300-0311426', '36401-0169478-7', 17000, 10000, NULL, '0318-0081426', 'Form WA0097 | Room type marked: three-seater | Intake flags: father''s name & occupation left blank on form'),
    ('206', 'Aamir Shehzad', '0302-6473490', '35302-8108066-3', 26000, 10000, 'Pervez Masih', '0326-6578813', 'Form WA0098 | Occupation: Retired Army | Room type marked: three-seater | Intake flags: room206 now at exactly capacity 3 (WA0082, WA0087, WA0098)'),
    ('105', 'Haroon Rasheed', '0321-7080826', '31102-5811198-5', 16000, 10000, 'Rasheed Ahmad', '0307-7030612', 'Form WA0099 | Occupation: Agriculture | Room type marked: three-seater | Intake flags: near-identical address to WA0096'),
    ('105', 'Qasim Ali Abbas', '0346-5124255', '82203-4368228-7', 17000, 13000, 'Rashid Mahmood', '0304-5943258', 'Form WA0100 | Occupation: Government Teacher | Room type marked: three-seater | Intake flags: address largely illegible; room105 now at exactly capacity 3 (WA0096, WA0099, WA0100)'),
    ('302', 'Nabeel Zafar', '0320-0675320', '36302-6032989-7', 17000, 13000, 'Zafar Karim', '0338-6439773', 'Form WA0101 | Occupation: Retired | Room type marked: three-seater'),
    ('201', 'Munir Akhtar', '0316-0971327', '71501-9392599-9', 12000, 13000, 'Ameer Hamza', '0816-0971327', 'Form WA0102 | Room type marked: single | Intake flags: rent may be misread, could be 17,000; own & father''s mobile differ only in first 4 digits, worth confirming'),
    ('106', 'Khalid Javed Kiani', '0333-5203749', '37405-7598966-9', 27000, 10000, 'Abdullah Khalid Kiani', '0336-5884602', 'Form WA0103 | Occupation: Retired | Room type marked: single | Intake flags: room106 predicted 3-seater but marked single'),
    ('106', 'Anwar Ahmad', NULL, '37406-0277187-3', 5000, 0, 'Hamza Anwar', '0310-5696067', 'Form WA0104 | Occupation: Deceased | Room type marked: two-seater | Security deposit not recorded — needs owner input | Intake flags: own mobile blank; rent unusually low (5,000), please confirm; two-seater isn''t a real room type here - checkbox likely miswritten'),
    (NULL, 'Taha Khan', '0300-6732977', '31303-7617589-7', 0, 0, NULL, '0301-7610799', 'Form WA0105 | Room type marked: three-seater | Unconfirmed room (source: "?") — assign manually | Rent not recorded — needs owner input | Security deposit not recorded — needs owner input | Intake flags: CNIC verified against ID card, exact match, full name on card is Mohammad Taha Khan; father''s name/occupation blank; 20/11 doesn''t resolve to one floor - see WA0108, identical pairing'),
    ('207', 'Muhammad Haseeb Shehzad', '0345-7792592', '35502-0221237-9', 17000, 17000, 'Khurram Shehzad', '0326-5454608', 'Form WA0106 | Occupation: Farmer | Room type marked: three-seater | Intake flags: rent equals security exactly, annotated "without mess" - unusual, please confirm'),
    ('102', 'Muhammad Raeyal Khan', '0341-3348333', '16102-5921813-1', 24000, 13000, 'Pervaiz Khan', '0346-5461336', 'Form WA0107 | Occupation: Trainer | Room type marked: single | Low-confidence name reading — verify against original form | Intake flags: given name uncertain, cursive; room102 predicted 3-seater but marked single'),
    (NULL, 'Muhammad Touseef Anwar', '0370-6010149', '36603-2054720-3', 0, 0, 'Muhammad Anwar', '0309-9379984', 'Form WA0108 | Room type marked: three-seater | Unconfirmed room (source: "?") — assign manually | Rent not recorded — needs owner input | Security deposit not recorded — needs owner input | Intake flags: CNIC verified against ID card, exact match; rent & security blank; identical 20/11 pairing as WA0105 - same room, meaning still unclear'),
    ('205', 'Syed Zain-ul-Abideen', '0316-1930563', '36603-9270857-1', 15000, 10000, 'Khalid Mahmood Shah', '0331-8099128', 'Form WA0109 | Occupation: Business Man | Room type marked: three-seater | Intake flags: room205 now at exactly capacity 3 (WA0081, WA0092, WA0109)'),
    (NULL, 'Muhammad Aurangzeb', '0300-6732977', '31303-5932983-9', 0, 0, 'Munir Ahmed', '0300-6799927', 'Form WA0110 | Occupation: Business | Room type marked: three-seater | Unconfirmed room (source: "104?") — assign manually | Rent not recorded — needs owner input | Security deposit not recorded — needs owner input | Intake flags: room number corrected twice on the form, recheck original; mobile identical to WA0105''s, worth confirming; rent & security blank; would put room104 at 4 tenants - over capacity if correct'),
    ('108', 'Unknown tenant', '0321-7879336', '34104-5223780-1', 0, 0, 'Sikandar Mushtaq', '0313-7613628', 'Form WA0112 | Occupation: Zamindar | Room type marked: three-seater | Low-confidence name reading — verify against original form; Illegible name — illegible - possibly Zubair Sikandar or Dayar Sikandar | Rent not recorded — needs owner input | Security deposit not recorded — needs owner input | Intake flags: tenant''s given name genuinely illegible; rent & security blank'),
    (NULL, 'Ali Muzaffar', '0303-7256815', '38602-4772424-5', 16000, 9000, 'Qamar Saleem', '0301-7563601', 'Form WA0113 | Room type marked: single | Unconfirmed room (source: "208?") — assign manually | Intake flags: "268" isn''t a valid room code, likely a misread; father''s mobile identical to WA0119''s own mobile, worth confirming; part of room-208 overcapacity issue'),
    ('108', 'Muhammad Awais', '0333-4322440', '34101-2541250-3', 23000, 10000, 'Hassaam Bin Awaid', '0330-4630374', 'Form WA0114 | Room type marked: three-seater'),
    ('103', 'Muhammad Rayan Mustafavi', NULL, '34201-4778606-3', 16000, 10000, 'Muhammad Tariq', '0301-1226964', 'Form WA0115 | Occupation: Engineer | Room type marked: three-seater | Low-confidence name reading — verify against original form | Intake flags: own mobile blank; same father name & city (Gujrat) as WA0088, likely coincidence, worth a glance; room103 now at exactly capacity 3 (WA0088, WA0090, WA0115)'),
    ('305', 'Nauman Taimoor', '0340-6184934', '34602-0211972-3', 23000, 10000, 'Muhammad Taimoor Khan', '0342-6984074', 'Form WA0116 | Occupation: Government Teacher | Room type marked: three-seater | Low-confidence name reading — verify against original form | Intake flags: room number field shows an earlier value struck through'),
    ('104', 'Nauman Ali', '0300-4168098', '35403-8622092-9', 27000, 10000, 'Muhammad Jameel', '0320-5828601', 'Form WA0117 | Occupation: Businessman | Room type marked: three-seater | Low-confidence name reading — verify against original form | Intake flags: room104 now at exactly capacity 3 (WA0094, WA0117, WA0121)'),
    ('109', 'Muhammad Bilal Sajid', '0311-6321512', '35503-0238444-9', 22000, 10000, 'Sajid Imran', '0300-2706276', 'Form WA0118 | Occupation: Business | Room type marked: three-seater | Intake flags: entry date illegible'),
    ('208', 'Muhammad Hamza Saleem', '0301-7563601', '36602-7661056-5', 16000, 9000, 'Muhammad Saleem', '0330-4166495', 'Form WA0119 | Occupation: Business | Room type marked: single | Intake flags: mobile identical to WA0113''s father-mobile, worth confirming; room is confirmed as 208 but 208 is a 3-seater - checkbox says single; room-208 overcapacity issue'),
    (NULL, 'Unknown tenant', '0331-2297265', '44206-8668614-1', 17000, 8000, 'Manzoor Ali', '0333-0500556', 'Form WA0120 | Room type marked: single | Unconfirmed room (source: "?") — assign manually | Low-confidence name reading — verify against original form; Illegible name — illegible, starts with S | Intake flags: tenant name illegible; room pairing 9-24 doesn''t resolve to one floor; both candidate rooms would be 3-seater, but marked single'),
    ('104', 'Muhammad Asim Jahanzaib', '0313-4472903', '35403-9053203-1', 24000, 10000, 'Ejaz Ali', '0346-0663372', 'Form WA0121 | Occupation: Teacher | Room type marked: single + three-seater (both checked) | Intake flags: room104 confirmed via DB code, now at exactly capacity 3; but both seater checkboxes are marked, please confirm intent'),
    ('109', 'Hussain Habib', '0345-7961538', '33401-0442386-5', 22000, 10000, 'Muhammad Habib', '0314-3153559', 'Form WA0122 | Occupation: Lawyer | Room type marked: single | Intake flags: entry date illegible; room109 predicted 3-seater (also claimed by WA0118, three-seater) but this form says single'),
    (NULL, '(uncertain - Muhammad Qabeel or Khabeel)', '0303-2519734', '42401-2527154-9', 24000, 13000, 'Azmat Ullah', '0321-2339297', 'Form WA0123 | Occupation: Kaarigar / craftsman | Room type marked: single | Unconfirmed room (source: "102?") — assign manually | Low-confidence name reading — verify against original form | Intake flags: "902" isn''t a valid room code, likely a misread of the first number; if the 16 is the real signal, room102 predicted 3-seater but marked single')
) AS v(room_number, full_name, phone, cnic, monthly_rent, security_deposit, emergency_contact, emergency_phone, notes)
LEFT JOIN hms_rooms r
  ON r.hostel_id = '1ed0450f-99e5-4e24-a9b3-6dda70bcc35b'::uuid
  AND r.room_number = v.room_number;

-- Sync each room's occupied count + status from actual active tenants just inserted
UPDATE hms_rooms
SET occupied = sub.cnt,
    status = CASE WHEN sub.cnt >= hms_rooms.capacity THEN 'occupied' ELSE 'available' END
FROM (
  SELECT room_id, count(*) AS cnt
  FROM hms_tenants
  WHERE hostel_id = '1ed0450f-99e5-4e24-a9b3-6dda70bcc35b'::uuid
    AND is_active = true
    AND room_id IS NOT NULL
  GROUP BY room_id
) sub
WHERE hms_rooms.id = sub.room_id;
