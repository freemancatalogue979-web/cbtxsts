"""General-subject starter content: English, Maths and the sciences.

This replaces the old Law demo bank. Every question carries an explanation and a
topic so practice, mixed-topic runs, flashcards and the AI tutor all have
something real to work with. Rows are tuples to keep the file readable:

    (topic, difficulty, question, option A, option B, option C, option D, correct, explanation)
"""
from __future__ import annotations

# code, title, description, accent, topics (ordered)
COURSES: list[dict] = [
    {
        "code": "ENG 101",
        "title": "English Language",
        "description": "Grammar, vocabulary, punctuation, figures of speech and reading comprehension.",
        "accent": "violet",
        "topics": ["Grammar", "Vocabulary", "Punctuation", "Figures of Speech", "Comprehension Skills"],
    },
    {
        "code": "MTH 101",
        "title": "General Mathematics",
        "description": "Number work, algebra, geometry, fractions and percentages, statistics and probability.",
        "accent": "blue",
        "topics": ["Number & Arithmetic", "Algebra", "Geometry", "Fractions & Percentages", "Statistics & Probability"],
    },
    {
        "code": "BIO 101",
        "title": "Introductory Biology",
        "description": "Cells, genetics, the human body, ecology and how plants live.",
        "accent": "red",
        "topics": ["Cell Biology", "Genetics", "Human Physiology", "Ecology", "Plant Biology"],
    },
    {
        "code": "CHM 101",
        "title": "General Chemistry",
        "description": "Atoms, the periodic table, bonding, reactions and acids and bases.",
        "accent": "amber",
        "topics": ["Atomic Structure", "Periodic Table", "Chemical Bonding", "Reactions & Equations", "Acids & Bases"],
    },
    {
        "code": "PHY 101",
        "title": "General Physics",
        "description": "Motion, forces, energy, electricity, waves and light.",
        "accent": "blue",
        "topics": ["Motion", "Forces & Newton's Laws", "Energy & Work", "Electricity", "Waves & Light"],
    },
    {
        "code": "CSC 101",
        "title": "Introduction to Computer Science",
        "description": "Hardware and software, number systems, algorithms, networks and programming basics.",
        "accent": "violet",
        "topics": ["Hardware & Software", "Number Systems", "Algorithms", "Networks & Internet", "Programming Basics"],
    },
]

E, M, H = "easy", "medium", "hard"

_RAW: dict[str, list[tuple]] = {
    "ENG 101": [
        ("Grammar", E, "Choose the correct form: \"She ___ to school every day.\"", "go", "goes", "going", "gone", "B", "With a third-person singular subject (she) the present simple verb takes -s: she goes."),
        ("Grammar", E, "Which word is a pronoun in the sentence \"They finished the project early\"?", "They", "finished", "project", "early", "A", "A pronoun stands in for a noun. \"They\" replaces the names of the people."),
        ("Grammar", M, "Pick the sentence with correct subject–verb agreement.", "The list of items are on the desk.", "The list of items is on the desk.", "The list of items were on the desk.", "The list of items be on the desk.", "B", "The subject is \"list\" (singular), not \"items\", so the verb is \"is\"."),
        ("Grammar", M, "\"If I ___ you, I would apologise.\" Choose the correct verb.", "am", "was", "were", "be", "C", "Hypothetical conditionals use the subjunctive \"were\" for every person: if I were you."),
        ("Grammar", M, "Identify the adverb: \"The orchestra played beautifully last night.\"", "orchestra", "played", "beautifully", "night", "C", "An adverb describes how an action is done. \"Beautifully\" tells us how they played."),
        ("Grammar", H, "Which sentence is in the passive voice?", "The chef cooked the meal.", "The meal was cooked by the chef.", "The chef is cooking.", "The chef will cook tonight.", "B", "In the passive voice the object of the action becomes the subject: the meal was cooked (by the chef)."),
        ("Grammar", M, "Choose the correct option: \"Neither the teacher nor the students ___ ready.\"", "was", "is", "were", "has been", "C", "With neither…nor, the verb agrees with the nearer subject. \"Students\" is plural, so \"were\"."),
        ("Grammar", E, "What is the past tense of \"write\"?", "writed", "wrote", "written", "writes", "B", "\"Write\" is irregular: write – wrote – written. \"Wrote\" is the simple past."),
        ("Vocabulary", E, "Choose the word closest in meaning to \"rapid\".", "slow", "quick", "quiet", "heavy", "B", "Rapid means happening at great speed — a synonym of quick."),
        ("Vocabulary", E, "What is the opposite of \"generous\"?", "kind", "selfish", "wealthy", "honest", "B", "Generous means willing to give; its antonym is selfish (or mean)."),
        ("Vocabulary", M, "\"The evidence was ambiguous.\" Ambiguous means:", "clear and certain", "open to more than one interpretation", "completely false", "very old", "B", "Something ambiguous can be understood in more than one way."),
        ("Vocabulary", M, "Choose the correctly spelled word.", "accomodate", "acommodate", "accommodate", "acomodate", "C", "Accommodate has a double c and a double m."),
        ("Vocabulary", H, "A person who is \"meticulous\" is:", "careless", "extremely careful about detail", "very talkative", "easily frightened", "B", "Meticulous describes someone who pays great attention to every detail."),
        ("Vocabulary", M, "Which word means \"to make something less severe\"?", "aggravate", "alleviate", "accelerate", "allocate", "B", "To alleviate pain or a problem is to make it less severe. Aggravate means the opposite."),
        ("Punctuation", E, "Which sentence uses the apostrophe correctly?", "The dog wagged it's tail.", "The dog wagged its tail.", "The dog wagged its' tail.", "The dog wagged it is tail.", "B", "\"Its\" (no apostrophe) is possessive. \"It's\" always means \"it is\" or \"it has\"."),
        ("Punctuation", M, "Choose the correctly punctuated sentence.", "I love cooking my family and my pets.", "I love cooking, my family, and my pets.", "I love, cooking my family and my pets.", "I love cooking my family, and, my pets.", "B", "Commas separate items in a list. Without them the sentence says something very different!"),
        ("Punctuation", M, "Which mark joins two closely related independent clauses without a conjunction?", "comma", "semicolon", "apostrophe", "hyphen", "B", "A semicolon links two complete sentences that are closely related: It rained; the match was cancelled."),
        ("Punctuation", H, "Where should the colon go? \"You need three things__ a pen, paper and patience.\"", "after \"need\"", "after \"things\"", "after \"pen\"", "No colon is needed", "B", "A colon introduces a list after a complete clause: You need three things: a pen, paper and patience."),
        ("Figures of Speech", E, "\"The classroom was a zoo.\" This is an example of:", "simile", "metaphor", "onomatopoeia", "alliteration", "B", "A metaphor says one thing IS another without using \"like\" or \"as\"."),
        ("Figures of Speech", E, "\"She is as brave as a lion\" is a:", "metaphor", "simile", "hyperbole", "personification", "B", "A simile compares two things using \"like\" or \"as\"."),
        ("Figures of Speech", M, "\"The wind whispered through the trees\" uses:", "personification", "irony", "oxymoron", "pun", "A", "Personification gives human qualities (whispering) to something non-human (the wind)."),
        ("Figures of Speech", M, "\"I've told you a million times!\" is an example of:", "understatement", "hyperbole", "simile", "euphemism", "B", "Hyperbole is deliberate exaggeration for effect."),
        ("Figures of Speech", H, "Which phrase is an oxymoron?", "bright sunshine", "deafening silence", "cold ice", "tall tower", "B", "An oxymoron puts contradictory words side by side: silence cannot literally be deafening."),
        ("Figures of Speech", M, "\"Peter Piper picked a peck of pickled peppers\" shows:", "assonance", "alliteration", "metaphor", "irony", "B", "Alliteration repeats the same starting consonant sound (p) in nearby words."),
        ("Comprehension Skills", E, "The main idea of a paragraph is usually found in the:", "topic sentence", "last word", "title page", "footnote", "A", "The topic sentence (often the first) states what the paragraph is about; the rest supports it."),
        ("Comprehension Skills", M, "When a writer \"infers\" something, the reader must:", "copy it word for word", "work out meaning that is suggested but not stated", "ignore it", "find it in a dictionary", "B", "Inference means reading between the lines — using clues to reach a conclusion the text implies."),
        ("Comprehension Skills", M, "A text written mainly to persuade the reader will most likely contain:", "only numbered steps", "opinions, emotive language and a call to action", "a list of ingredients", "no adjectives at all", "B", "Persuasive writing argues a viewpoint using opinion, emotive words and often asks the reader to act."),
        ("Comprehension Skills", H, "The \"tone\" of a passage refers to:", "the number of paragraphs", "the writer's attitude towards the subject", "the font used", "the length of sentences only", "B", "Tone is the author's attitude — e.g. serious, humorous, sarcastic or hopeful."),
    ],
    "MTH 101": [
        ("Number & Arithmetic", E, "What is 7 × 8?", "54", "56", "58", "64", "B", "7 × 8 = 56."),
        ("Number & Arithmetic", E, "What is the value of 3 + 4 × 2?", "14", "11", "10", "9", "B", "Multiplication comes before addition (BODMAS/PEMDAS): 4 × 2 = 8, then 3 + 8 = 11."),
        ("Number & Arithmetic", M, "Which of these is a prime number?", "21", "27", "29", "33", "C", "29 has exactly two factors, 1 and 29. 21 = 3×7, 27 = 3×9, 33 = 3×11."),
        ("Number & Arithmetic", M, "What is the lowest common multiple (LCM) of 4 and 6?", "2", "12", "24", "10", "B", "Multiples of 4: 4, 8, 12… Multiples of 6: 6, 12… The first shared one is 12."),
        ("Number & Arithmetic", M, "What is √144?", "11", "12", "14", "72", "B", "12 × 12 = 144, so the square root of 144 is 12."),
        ("Number & Arithmetic", H, "Write 0.000 45 in standard form.", "4.5 × 10⁻⁴", "4.5 × 10⁻³", "45 × 10⁻⁵", "4.5 × 10⁴", "A", "Move the decimal point 4 places right to get 4.5, so the power is −4: 4.5 × 10⁻⁴."),
        ("Algebra", E, "Solve for x: x + 9 = 15", "4", "6", "24", "9", "B", "Subtract 9 from both sides: x = 15 − 9 = 6."),
        ("Algebra", E, "Solve: 3x = 21", "6", "7", "18", "63", "B", "Divide both sides by 3: x = 21 ÷ 3 = 7."),
        ("Algebra", M, "Simplify: 2(x + 3) − x", "x + 6", "x + 3", "3x + 6", "2x + 3", "A", "Expand: 2x + 6 − x = x + 6."),
        ("Algebra", M, "Solve: 2x − 5 = 11", "3", "8", "6", "16", "B", "Add 5: 2x = 16, then divide by 2: x = 8."),
        ("Algebra", M, "If y = 2x² and x = 3, what is y?", "12", "18", "36", "9", "B", "x² = 9, then y = 2 × 9 = 18. (Square first, then multiply.)"),
        ("Algebra", H, "Factorise: x² − 9", "(x − 3)(x − 3)", "(x + 3)(x − 3)", "(x + 9)(x − 1)", "x(x − 9)", "B", "x² − 9 is a difference of two squares: a² − b² = (a + b)(a − b), so (x + 3)(x − 3)."),
        ("Algebra", H, "What are the solutions of x² − 5x + 6 = 0?", "x = 2 or x = 3", "x = −2 or x = −3", "x = 1 or x = 6", "x = −1 or x = 6", "A", "x² − 5x + 6 = (x − 2)(x − 3) = 0, so x = 2 or x = 3."),
        ("Geometry", E, "How many degrees are there in the angles of a triangle altogether?", "90°", "180°", "270°", "360°", "B", "The interior angles of any triangle add up to 180°."),
        ("Geometry", E, "What is the area of a rectangle 8 cm long and 5 cm wide?", "13 cm²", "26 cm²", "40 cm²", "45 cm²", "C", "Area of a rectangle = length × width = 8 × 5 = 40 cm²."),
        ("Geometry", M, "A right-angled triangle has shorter sides 6 cm and 8 cm. How long is the hypotenuse?", "10 cm", "12 cm", "14 cm", "48 cm", "A", "Pythagoras: c² = 6² + 8² = 36 + 64 = 100, so c = 10 cm."),
        ("Geometry", M, "What is the circumference of a circle with radius 7 cm? (Use π ≈ 22/7)", "22 cm", "44 cm", "154 cm", "49 cm", "B", "C = 2πr = 2 × 22/7 × 7 = 44 cm."),
        ("Geometry", M, "Each interior angle of a regular hexagon is:", "108°", "120°", "135°", "90°", "B", "Interior angles of a hexagon sum to (6 − 2) × 180° = 720°; 720 ÷ 6 = 120°."),
        ("Geometry", H, "What is the area of a circle with radius 10 cm? (Use π ≈ 3.14)", "31.4 cm²", "62.8 cm²", "314 cm²", "100 cm²", "C", "A = πr² = 3.14 × 100 = 314 cm²."),
        ("Fractions & Percentages", E, "What is 1/2 + 1/4?", "2/6", "3/4", "1/6", "2/4", "B", "Use a common denominator: 2/4 + 1/4 = 3/4."),
        ("Fractions & Percentages", E, "What is 25% of 80?", "15", "20", "25", "40", "B", "25% is one quarter; 80 ÷ 4 = 20."),
        ("Fractions & Percentages", M, "A $60 jacket is reduced by 15%. What is the sale price?", "$45", "$51", "$54", "$9", "B", "15% of 60 = 9. 60 − 9 = $51."),
        ("Fractions & Percentages", M, "Write 3/8 as a decimal.", "0.38", "0.375", "0.83", "0.3", "B", "3 ÷ 8 = 0.375."),
        ("Fractions & Percentages", H, "A price rises from £40 to £50. What is the percentage increase?", "10%", "20%", "25%", "50%", "C", "Increase = 10. Percentage increase = 10 ÷ 40 × 100 = 25% (always divide by the ORIGINAL)."),
        ("Statistics & Probability", E, "Find the mean of 2, 4, 6, 8.", "4", "5", "6", "20", "B", "Mean = total ÷ count = 20 ÷ 4 = 5."),
        ("Statistics & Probability", E, "What is the mode of 3, 5, 5, 7, 9?", "3", "5", "7", "9", "B", "The mode is the most frequent value: 5 appears twice."),
        ("Statistics & Probability", M, "Find the median of 9, 2, 7, 4, 5.", "4", "5", "7", "5.4", "B", "Order them: 2, 4, 5, 7, 9. The middle value is 5."),
        ("Statistics & Probability", M, "A fair die is rolled once. What is the probability of getting an even number?", "1/6", "1/3", "1/2", "2/3", "C", "Even outcomes are 2, 4, 6 → 3 out of 6 = 1/2."),
        ("Statistics & Probability", H, "Two fair coins are tossed. What is the probability of getting two heads?", "1/2", "1/3", "1/4", "3/4", "C", "Outcomes: HH, HT, TH, TT. Only one of four is HH, so 1/4."),
    ],
    "BIO 101": [
        ("Cell Biology", E, "Which organelle is known as the powerhouse of the cell?", "Nucleus", "Mitochondrion", "Ribosome", "Vacuole", "B", "Mitochondria carry out aerobic respiration, releasing energy (ATP) for the cell."),
        ("Cell Biology", E, "Which structure controls the activities of the cell and contains DNA?", "Cell membrane", "Cytoplasm", "Nucleus", "Cell wall", "C", "The nucleus holds the genetic material and controls cell activities."),
        ("Cell Biology", M, "Which of these is found in plant cells but NOT animal cells?", "Mitochondria", "Cell membrane", "Chloroplasts", "Ribosomes", "C", "Chloroplasts (and a cellulose cell wall) are found in plant cells, not animal cells."),
        ("Cell Biology", M, "The site of protein synthesis in a cell is the:", "ribosome", "nucleus", "vacuole", "lysosome", "A", "Ribosomes read messenger RNA and assemble amino acids into proteins."),
        ("Cell Biology", H, "The movement of water across a partially permeable membrane from a dilute to a concentrated solution is:", "diffusion", "osmosis", "active transport", "transpiration", "B", "Osmosis is the net movement of water molecules through a partially permeable membrane down a water potential gradient."),
        ("Genetics", E, "DNA stands for:", "Deoxyribonucleic acid", "Dinitrogen acid", "Deoxyribose nitrate", "Dynamic nucleic acid", "A", "DNA = deoxyribonucleic acid, the molecule that carries genetic instructions."),
        ("Genetics", M, "How many chromosomes are in a normal human body cell?", "23", "44", "46", "48", "C", "Human body cells have 46 chromosomes (23 pairs); gametes have 23."),
        ("Genetics", M, "An allele that is expressed whenever it is present is called:", "recessive", "dominant", "mutant", "codominant", "B", "A dominant allele shows its effect even if only one copy is present."),
        ("Genetics", H, "Two parents are both Tt (T = tall, dominant). What fraction of offspring are expected to be short (tt)?", "0", "1/4", "1/2", "3/4", "B", "A Tt × Tt cross gives TT : Tt : tt in the ratio 1 : 2 : 1, so 1/4 are tt (short)."),
        ("Human Physiology", E, "Which organ pumps blood around the body?", "Lungs", "Liver", "Heart", "Kidney", "C", "The heart is a muscular pump that pushes blood through the blood vessels."),
        ("Human Physiology", E, "Gas exchange in the lungs takes place in the:", "trachea", "bronchi", "alveoli", "diaphragm", "C", "Alveoli are tiny air sacs with thin walls and a rich blood supply, ideal for gas exchange."),
        ("Human Physiology", M, "Which blood cells fight infection?", "Red blood cells", "White blood cells", "Platelets", "Plasma", "B", "White blood cells engulf pathogens and produce antibodies."),
        ("Human Physiology", M, "Which organ filters blood to produce urine?", "Liver", "Kidney", "Pancreas", "Bladder", "B", "The kidneys filter the blood, removing urea and excess water as urine."),
        ("Human Physiology", H, "Insulin, which lowers blood glucose, is produced by the:", "liver", "pancreas", "thyroid", "adrenal glands", "B", "Beta cells in the pancreas release insulin when blood glucose rises."),
        ("Ecology", E, "In a food chain, organisms that make their own food are called:", "consumers", "producers", "decomposers", "predators", "B", "Producers (usually green plants) make food by photosynthesis."),
        ("Ecology", M, "Organisms that break down dead material and return nutrients to the soil are:", "herbivores", "decomposers", "carnivores", "parasites", "B", "Decomposers such as bacteria and fungi recycle nutrients from dead organisms."),
        ("Ecology", M, "Grass → rabbit → fox. The rabbit is a:", "producer", "primary consumer", "secondary consumer", "decomposer", "B", "The rabbit eats the producer (grass), so it is the primary consumer."),
        ("Ecology", H, "Roughly what percentage of energy passes from one trophic level to the next?", "1%", "10%", "50%", "90%", "B", "Only about 10% is passed on; the rest is lost as heat, movement and waste."),
        ("Plant Biology", E, "Which gas do plants take in for photosynthesis?", "Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen", "C", "Photosynthesis uses carbon dioxide and water, with light energy, to make glucose and oxygen."),
        ("Plant Biology", M, "The green pigment that absorbs light in plants is:", "haemoglobin", "chlorophyll", "melanin", "keratin", "B", "Chlorophyll in chloroplasts absorbs light energy for photosynthesis."),
        ("Plant Biology", M, "Water moves up a plant through the:", "phloem", "xylem", "stomata", "root hairs only", "B", "Xylem vessels carry water and minerals from the roots up to the leaves."),
        ("Plant Biology", H, "The loss of water vapour from the leaves of a plant is called:", "translocation", "transpiration", "respiration", "germination", "B", "Transpiration is evaporation of water from leaves, mainly through the stomata."),
    ],
    "CHM 101": [
        ("Atomic Structure", E, "Which particle in an atom has a negative charge?", "Proton", "Neutron", "Electron", "Nucleus", "C", "Electrons carry a −1 charge; protons are +1 and neutrons are neutral."),
        ("Atomic Structure", E, "The atomic number of an element tells you the number of:", "neutrons", "protons", "molecules", "isotopes", "B", "Atomic number = number of protons in the nucleus (equal to electrons in a neutral atom)."),
        ("Atomic Structure", M, "An atom has 11 protons and 12 neutrons. What is its mass number?", "11", "12", "23", "1", "C", "Mass number = protons + neutrons = 11 + 12 = 23 (this is sodium-23)."),
        ("Atomic Structure", H, "Atoms of the same element with different numbers of neutrons are called:", "ions", "isotopes", "isomers", "allotropes", "B", "Isotopes share the same proton number but differ in neutron number, e.g. carbon-12 and carbon-14."),
        ("Periodic Table", E, "What is the chemical symbol for sodium?", "S", "So", "Na", "Sd", "C", "Sodium's symbol Na comes from its Latin name, natrium."),
        ("Periodic Table", M, "Elements in the same group of the periodic table have the same number of:", "neutrons", "electron shells", "outer-shell electrons", "protons", "C", "Group number relates to the number of outer electrons, which is why group members react similarly."),
        ("Periodic Table", M, "Which group contains the unreactive noble gases?", "Group 1", "Group 2", "Group 7", "Group 0 (18)", "D", "Noble gases (helium, neon, argon…) have full outer shells and sit in Group 0/18."),
        ("Periodic Table", H, "Going down Group 1 (the alkali metals), reactivity:", "decreases", "increases", "stays the same", "first rises then falls", "B", "The outer electron is further from the nucleus, so it is lost more easily — reactivity increases."),
        ("Chemical Bonding", E, "Water has the chemical formula:", "HO", "H₂O", "H₂O₂", "OH₂", "B", "Each water molecule has two hydrogen atoms bonded to one oxygen atom."),
        ("Chemical Bonding", M, "Sodium chloride is held together by:", "covalent bonds", "ionic bonds", "metallic bonds", "hydrogen bonds", "B", "Na gives an electron to Cl, forming Na⁺ and Cl⁻ ions held by ionic attraction."),
        ("Chemical Bonding", M, "A covalent bond is formed when atoms:", "transfer electrons", "share pairs of electrons", "lose protons", "share neutrons", "B", "Covalent bonds are shared pairs of electrons, usually between non-metals."),
        ("Chemical Bonding", H, "Why do ionic compounds have high melting points?", "weak forces between molecules", "strong electrostatic forces between oppositely charged ions", "they contain free electrons", "they are always gases", "B", "Lots of energy is needed to overcome the strong attractions in the giant ionic lattice."),
        ("Reactions & Equations", E, "Rusting of iron needs:", "oxygen and water", "nitrogen only", "carbon dioxide only", "heat only", "A", "Iron rusts when it reacts with both oxygen and water."),
        ("Reactions & Equations", M, "Balance: __H₂ + O₂ → __H₂O", "1 and 1", "2 and 2", "2 and 1", "1 and 2", "B", "2H₂ + O₂ → 2H₂O gives 4 H and 2 O atoms on each side."),
        ("Reactions & Equations", M, "A reaction that gives out heat to the surroundings is:", "endothermic", "exothermic", "neutral", "reversible", "B", "Exothermic reactions release energy (e.g. combustion); endothermic ones absorb it."),
        ("Reactions & Equations", H, "A catalyst speeds up a reaction by:", "raising the temperature", "providing a pathway with lower activation energy", "being used up", "increasing the amount of product", "B", "Catalysts lower the activation energy and are not used up in the reaction."),
        ("Acids & Bases", E, "A solution with a pH of 2 is:", "strongly acidic", "neutral", "weakly alkaline", "strongly alkaline", "A", "pH below 7 is acidic; pH 2 is strongly acidic. 7 is neutral; above 7 is alkaline."),
        ("Acids & Bases", M, "Acid + alkali → salt + ___", "hydrogen", "water", "oxygen", "carbon dioxide", "B", "Neutralisation: an acid and an alkali react to form a salt and water."),
        ("Acids & Bases", M, "Which indicator turns red in acid and blue in alkali?", "Litmus", "Starch", "Iodine", "Limewater", "A", "Litmus is red in acid and blue in alkali."),
        ("Acids & Bases", H, "Acids are substances that release which ions in water?", "OH⁻", "H⁺", "Na⁺", "Cl⁻", "B", "Acids release hydrogen ions (H⁺); alkalis release hydroxide ions (OH⁻)."),
    ],
    "PHY 101": [
        ("Motion", E, "Speed is calculated as:", "distance × time", "distance ÷ time", "time ÷ distance", "mass × acceleration", "B", "Speed = distance travelled ÷ time taken."),
        ("Motion", M, "A car travels 150 km in 3 hours. What is its average speed?", "30 km/h", "50 km/h", "150 km/h", "450 km/h", "B", "150 ÷ 3 = 50 km/h."),
        ("Motion", M, "Acceleration is the rate of change of:", "distance", "velocity", "mass", "force", "B", "Acceleration = change in velocity ÷ time taken."),
        ("Motion", H, "A cyclist speeds up from 2 m/s to 10 m/s in 4 s. What is the acceleration?", "2 m/s²", "2.5 m/s²", "3 m/s²", "8 m/s²", "A", "a = (v − u) ÷ t = (10 − 2) ÷ 4 = 2 m/s²."),
        ("Forces & Newton's Laws", E, "The unit of force is the:", "joule", "watt", "newton", "pascal", "C", "Force is measured in newtons (N), named after Isaac Newton."),
        ("Forces & Newton's Laws", M, "A 2 kg mass accelerates at 3 m/s². What is the resultant force?", "1.5 N", "5 N", "6 N", "9 N", "C", "F = m × a = 2 × 3 = 6 N (Newton's second law)."),
        ("Forces & Newton's Laws", M, "\"For every action there is an equal and opposite reaction\" is Newton's:", "first law", "second law", "third law", "law of gravitation", "C", "Newton's third law: forces always come in equal and opposite pairs."),
        ("Forces & Newton's Laws", H, "On Earth (g ≈ 10 N/kg), what is the weight of a 60 kg person?", "6 N", "60 N", "600 N", "6000 N", "C", "Weight = mass × gravitational field strength = 60 × 10 = 600 N."),
        ("Energy & Work", E, "The energy an object has because it is moving is:", "potential energy", "kinetic energy", "chemical energy", "nuclear energy", "B", "Kinetic energy is the energy of motion."),
        ("Energy & Work", M, "Work done equals:", "force × distance moved in the direction of the force", "mass × velocity", "power × force", "force ÷ time", "A", "W = F × d. Measured in joules."),
        ("Energy & Work", M, "Power is measured in:", "joules", "newtons", "watts", "volts", "C", "Power is energy transferred per second; 1 watt = 1 joule per second."),
        ("Energy & Work", H, "A 2 kg ball moves at 3 m/s. What is its kinetic energy?", "3 J", "6 J", "9 J", "18 J", "C", "KE = ½mv² = ½ × 2 × 3² = 9 J."),
        ("Electricity", E, "Electric current is measured in:", "volts", "amperes", "ohms", "watts", "B", "Current is measured in amperes (amps) using an ammeter."),
        ("Electricity", M, "Using V = IR, what is the voltage across a 4 Ω resistor carrying 3 A?", "0.75 V", "7 V", "12 V", "1.3 V", "C", "V = I × R = 3 × 4 = 12 V."),
        ("Electricity", M, "Which material is a good electrical insulator?", "Copper", "Rubber", "Aluminium", "Salt water", "B", "Rubber does not let charge flow easily, so it insulates wires."),
        ("Electricity", H, "Two 6 Ω resistors are connected in series. Their total resistance is:", "3 Ω", "6 Ω", "12 Ω", "36 Ω", "C", "In series resistances add: 6 + 6 = 12 Ω. (In parallel it would be 3 Ω.)"),
        ("Waves & Light", E, "Light travels fastest through:", "water", "glass", "a vacuum", "steel", "C", "Light is fastest in a vacuum, about 300 000 km/s."),
        ("Waves & Light", M, "The bending of light as it passes from air into glass is called:", "reflection", "refraction", "diffraction", "dispersion", "B", "Refraction happens because light changes speed when it enters a new medium."),
        ("Waves & Light", M, "Sound cannot travel through:", "water", "air", "a vacuum", "steel", "C", "Sound needs particles to vibrate, so it cannot travel through empty space."),
        ("Waves & Light", H, "A wave has frequency 5 Hz and wavelength 2 m. What is its speed?", "2.5 m/s", "7 m/s", "10 m/s", "0.4 m/s", "C", "Wave speed = frequency × wavelength = 5 × 2 = 10 m/s."),
    ],
    "CSC 101": [
        ("Hardware & Software", E, "Which of these is an input device?", "Monitor", "Printer", "Keyboard", "Speaker", "C", "A keyboard sends data into the computer; the others are output devices."),
        ("Hardware & Software", E, "The \"brain\" of the computer that carries out instructions is the:", "RAM", "CPU", "hard drive", "GPU fan", "B", "The CPU (central processing unit) fetches, decodes and executes instructions."),
        ("Hardware & Software", M, "Which type of memory loses its contents when the power is switched off?", "ROM", "RAM", "SSD", "Flash drive", "B", "RAM is volatile: it only holds data while powered."),
        ("Hardware & Software", M, "Windows, macOS and Linux are examples of:", "application software", "operating systems", "programming languages", "web browsers", "B", "An operating system manages hardware and provides a platform for applications."),
        ("Number Systems", E, "How many bits are there in one byte?", "4", "8", "16", "1024", "B", "1 byte = 8 bits."),
        ("Number Systems", M, "What is the binary number 1010 in decimal?", "8", "10", "12", "1010", "B", "1010₂ = 8 + 0 + 2 + 0 = 10."),
        ("Number Systems", M, "What is decimal 7 in binary?", "101", "110", "111", "1001", "C", "7 = 4 + 2 + 1, so 111₂."),
        ("Number Systems", H, "The hexadecimal digit F represents which decimal value?", "14", "15", "16", "10", "B", "Hex uses 0–9 then A=10 … F=15."),
        ("Algorithms", E, "An algorithm is:", "a type of computer virus", "a step-by-step set of instructions to solve a problem", "a hardware component", "a programming language", "B", "An algorithm is a precise sequence of steps that solves a problem."),
        ("Algorithms", M, "Which search works only on a SORTED list by repeatedly halving it?", "Linear search", "Binary search", "Bubble search", "Random search", "B", "Binary search compares with the middle item and discards half the list each step."),
        ("Algorithms", M, "In a flowchart, a diamond shape represents a:", "start/end", "process", "decision", "input/output", "C", "Diamonds are decisions (yes/no questions); rectangles are processes."),
        ("Algorithms", H, "Binary search on a sorted list of 1,024 items needs at most about how many comparisons?", "10", "100", "512", "1024", "A", "Each step halves the list: 2¹⁰ = 1024, so about 10 comparisons."),
        ("Networks & Internet", E, "What does \"www\" stand for?", "World Wide Web", "Wide Web World", "Web World Wide", "World Web Wire", "A", "www = World Wide Web, the system of linked web pages on the internet."),
        ("Networks & Internet", M, "A network covering a single building, such as a school, is a:", "WAN", "LAN", "MAN", "VPN", "B", "LAN = local area network, covering a small area."),
        ("Networks & Internet", M, "Which protocol keeps web traffic encrypted?", "HTTP", "HTTPS", "FTP", "SMTP", "B", "HTTPS adds encryption (TLS) to HTTP, shown by the padlock in the browser."),
        ("Networks & Internet", H, "A phishing attack mainly tries to:", "overheat your computer", "trick you into revealing personal information", "speed up your network", "update your software", "B", "Phishing uses fake emails or sites to trick people into giving passwords or card details."),
        ("Programming Basics", E, "A named storage location in a program whose value can change is a:", "constant", "variable", "loop", "comment", "B", "Variables store data that can change while the program runs."),
        ("Programming Basics", M, "Which structure repeats a block of code?", "selection (if)", "loop", "comment", "variable", "B", "Loops (for, while) repeat code; if-statements choose between paths."),
        ("Programming Basics", M, "What is the output of: x = 3; x = x + 2; print(x)", "3", "2", "5", "x + 2", "C", "x starts at 3, then becomes 3 + 2 = 5, which is printed."),
        ("Programming Basics", H, "In most languages, what is 17 % 5 (the modulus operator)?", "3", "2", "3.4", "12", "B", "% gives the remainder: 17 = 3 × 5 + 2, so 17 % 5 = 2."),
    ],
}


def questions_for(code: str) -> list[dict]:
    """Rows in the shape the seeder and Question model expect."""
    out = []
    for topic, difficulty, text, a, b, c, d, correct, explanation in _RAW.get(code, []):
        out.append({
            "text": text, "option_a": a, "option_b": b, "option_c": c, "option_d": d,
            "correct": correct, "explanation": explanation, "difficulty": difficulty, "topic": topic,
        })
    return out


# --------------------------------------------------------------- materials
def _p(text: str) -> dict:
    return {"type": "paragraph", "text": text}


def _h(text: str) -> dict:
    return {"type": "subheading", "text": text}


def _k(term: str, meaning: str) -> dict:
    return {"type": "keyterm", "term": term, "meaning": meaning}


def _l(*items: str) -> dict:
    return {"type": "list", "items": list(items)}


def _ex(text: str, title: str = "Example") -> dict:
    return {"type": "example", "title": title, "text": text}


def _tip(text: str, title: str = "Exam tip") -> dict:
    return {"type": "tip", "title": title, "text": text}


# Each material: course code, title, topic, description, minutes, difficulty, summary, sections[(title, topic-ish, blocks)]
MATERIALS: list[dict] = [
    {
        "course": "ENG 101", "title": "English Grammar Essentials", "topic": "Grammar", "difficulty": "beginner", "minutes": 18, "icon": "book-open",
        "description": "Parts of speech, verb tenses, agreement and voice — the grammar that shows up in every English paper.",
        "summary": ["A singular subject takes a singular verb — find the real subject first.", "Hypotheticals use \"were\": if I were you.", "Passive voice: object + be + past participle.", "With neither…nor, the verb agrees with the nearer subject."],
        "sections": [
            ("Parts of speech", [
                _p("Every word in a sentence has a job. Knowing the jobs helps you fix errors quickly."),
                _k("Noun", "A person, place, thing or idea: teacher, London, laptop, courage."),
                _k("Pronoun", "A word that replaces a noun: he, she, it, they, we."),
                _k("Verb", "An action or state: run, write, is, seem."),
                _k("Adjective", "Describes a noun: a bright idea."),
                _k("Adverb", "Describes a verb, adjective or other adverb — often ends in -ly: she sang beautifully."),
                _ex("In \"They finished the project early\": They = pronoun, finished = verb, project = noun, early = adverb."),
            ]),
            ("Subject–verb agreement", [
                _p("The verb must agree with its subject in number. Singular subject → singular verb; plural subject → plural verb."),
                _l("Find the real subject — ignore phrases like \"of items\": The list of items IS on the desk.", "Third-person singular present verbs take -s: she goes, he writes.", "Neither…nor / either…or: the verb agrees with the nearer subject: Neither the teacher nor the students WERE ready."),
                _tip("Cross out the prepositional phrase (of…, with…, in…) and read the sentence again — the agreement becomes obvious."),
            ]),
            ("Tenses and the subjunctive", [
                _p("Regular verbs add -ed for the past (walk → walked). Irregular verbs must be learnt: write → wrote → written, go → went → gone."),
                _p("For imaginary or unlikely situations English uses the subjunctive \"were\" with every subject."),
                _ex("If I were you, I would apologise. (Not: if I was you.)"),
            ]),
            ("Active and passive voice", [
                _p("In the active voice the subject does the action. In the passive voice the subject receives the action."),
                _l("Active: The chef cooked the meal.", "Passive: The meal was cooked by the chef.", "Form: object + a form of \"be\" + past participle (+ by …)."),
                _tip("Use the passive when the doer is unknown or unimportant: The window was broken."),
            ]),
        ],
    },
    {
        "course": "ENG 101", "title": "Figures of Speech & Punctuation", "topic": "Figures of Speech", "difficulty": "intermediate", "minutes": 14, "icon": "feather",
        "description": "Metaphor, simile, personification and friends — plus the punctuation marks that change meaning.",
        "summary": ["Simile uses like/as; metaphor says one thing IS another.", "Its = belonging to it; it's = it is.", "A semicolon joins two complete, related sentences.", "A colon introduces a list after a complete clause."],
        "sections": [
            ("Comparisons: simile and metaphor", [
                _k("Simile", "Compares using \"like\" or \"as\": as brave as a lion."),
                _k("Metaphor", "Says one thing IS another: the classroom was a zoo."),
                _k("Personification", "Gives human qualities to non-human things: the wind whispered."),
            ]),
            ("Sound and exaggeration", [
                _k("Alliteration", "Repeated starting consonant sounds: Peter Piper picked…"),
                _k("Hyperbole", "Deliberate exaggeration: I've told you a million times."),
                _k("Oxymoron", "Two contradictory words together: deafening silence, bitter-sweet."),
                _k("Onomatopoeia", "Words that sound like their meaning: buzz, crash, sizzle."),
            ]),
            ("Punctuation that changes meaning", [
                _l("Apostrophe: its (possessive) vs it's (it is / it has).", "Comma: separates list items — I love cooking, my family, and my pets.", "Semicolon: joins two related complete sentences — It rained; the match was cancelled.", "Colon: introduces a list or explanation after a full clause — You need three things: a pen, paper and patience."),
                _tip("Test it's by expanding it to \"it is\". If the sentence breaks, you need its."),
            ]),
            ("Reading like an examiner", [
                _p("The topic sentence states a paragraph's main idea. Inference means working out what the writer suggests but does not say. Tone is the writer's attitude — serious, sarcastic, hopeful."),
                _p("Persuasive texts use opinion, emotive language, rhetorical questions and a call to action."),
            ]),
        ],
    },
    {
        "course": "MTH 101", "title": "Algebra from Scratch", "topic": "Algebra", "difficulty": "beginner", "minutes": 20, "icon": "sigma",
        "description": "Solving equations, expanding brackets, factorising and quadratics — explained step by step.",
        "summary": ["Do the same thing to both sides of an equation.", "Order of operations: brackets, powers, ×/÷, then +/−.", "a² − b² = (a + b)(a − b).", "A quadratic that factorises gives two solutions."],
        "sections": [
            ("Order of operations", [
                _p("Work out Brackets, then Orders (powers and roots), then Division and Multiplication, then Addition and Subtraction (BODMAS / PEMDAS)."),
                _ex("3 + 4 × 2 = 3 + 8 = 11, not 14."),
            ]),
            ("Solving linear equations", [
                _p("An equation is a balance. Whatever you do to one side you must do to the other, until x is alone."),
                _ex("2x − 5 = 11 → add 5 → 2x = 16 → divide by 2 → x = 8."),
                _tip("Check your answer by substituting it back: 2(8) − 5 = 11 ✓."),
            ]),
            ("Expanding and simplifying", [
                _p("Multiply everything inside the bracket by the term outside, then collect like terms."),
                _ex("2(x + 3) − x = 2x + 6 − x = x + 6."),
                _p("Powers come before multiplication: if x = 3, 2x² = 2 × 9 = 18."),
            ]),
            ("Factorising and quadratics", [
                _k("Difference of two squares", "a² − b² = (a + b)(a − b). So x² − 9 = (x + 3)(x − 3)."),
                _p("To solve x² + bx + c = 0, find two numbers that multiply to c and add to b."),
                _ex("x² − 5x + 6: numbers −2 and −3 (multiply to 6, add to −5) → (x − 2)(x − 3) = 0 → x = 2 or x = 3."),
            ]),
        ],
    },
    {
        "course": "MTH 101", "title": "Geometry, Percentages & Statistics", "topic": "Geometry", "difficulty": "intermediate", "minutes": 22, "icon": "triangle",
        "description": "Angles, areas, Pythagoras, percentage change and averages — the formulas you must know.",
        "summary": ["Triangle angles sum to 180°; polygon angles sum to (n − 2) × 180°.", "Pythagoras: c² = a² + b².", "Circle: C = 2πr, A = πr².", "% change = change ÷ original × 100."],
        "sections": [
            ("Angles and shapes", [
                _l("Angles in a triangle add up to 180°.", "Angles around a point add up to 360°.", "Interior angles of an n-sided polygon add up to (n − 2) × 180°. A regular hexagon has 720° ÷ 6 = 120° per angle."),
            ]),
            ("Area, circles and Pythagoras", [
                _l("Rectangle: area = length × width.", "Circle: circumference C = 2πr, area A = πr².", "Right-angled triangle: c² = a² + b² (c is the hypotenuse)."),
                _ex("Sides 6 and 8: c² = 36 + 64 = 100, so c = 10."),
            ]),
            ("Fractions and percentages", [
                _p("Add fractions with a common denominator: 1/2 + 1/4 = 2/4 + 1/4 = 3/4. Convert a fraction to a decimal by dividing: 3/8 = 0.375."),
                _p("Percentage change = change ÷ original × 100. Always divide by the ORIGINAL value."),
                _ex("£40 → £50 is a £10 rise; 10 ÷ 40 × 100 = 25% increase."),
            ]),
            ("Averages and probability", [
                _k("Mean", "Total ÷ number of values."), _k("Median", "Middle value when the data are in order."), _k("Mode", "Most frequent value."),
                _p("Probability = favourable outcomes ÷ total outcomes. Two coins: HH, HT, TH, TT → P(two heads) = 1/4."),
            ]),
        ],
    },
    {
        "course": "BIO 101", "title": "Cells, Genes & the Human Body", "topic": "Cell Biology", "difficulty": "beginner", "minutes": 20, "icon": "dna",
        "description": "Cell organelles, DNA and inheritance, and how the heart, lungs and kidneys keep us alive.",
        "summary": ["Mitochondria release energy; ribosomes make proteins.", "Plant cells have chloroplasts and a cell wall.", "Humans have 46 chromosomes; Tt × Tt gives 1 : 2 : 1.", "Alveoli exchange gases; kidneys make urine; the pancreas makes insulin."],
        "sections": [
            ("Inside the cell", [
                _k("Nucleus", "Contains DNA and controls the cell."), _k("Mitochondrion", "Site of aerobic respiration — the powerhouse."), _k("Ribosome", "Where proteins are made."), _k("Chloroplast", "Plant cells only — where photosynthesis happens."),
                _p("Osmosis is the movement of water across a partially permeable membrane from a dilute to a more concentrated solution."),
            ]),
            ("Genetics", [
                _p("DNA (deoxyribonucleic acid) carries genetic instructions. Human body cells have 46 chromosomes in 23 pairs."),
                _p("A dominant allele shows its effect whenever present; a recessive allele only shows when two copies are present."),
                _ex("Tt × Tt → TT, Tt, Tt, tt. One in four offspring (1/4) is tt and shows the recessive trait."),
            ]),
            ("Body systems", [
                _l("The heart pumps blood around the body.", "Gas exchange happens in the alveoli of the lungs.", "White blood cells fight infection; red cells carry oxygen.", "The kidneys filter blood and make urine.", "The pancreas releases insulin to lower blood glucose."),
            ]),
            ("Plants and ecosystems", [
                _p("Photosynthesis: carbon dioxide + water → glucose + oxygen, using light absorbed by chlorophyll. Xylem carries water up; transpiration is water loss from leaves."),
                _p("In a food chain, producers make food, consumers eat, and decomposers recycle nutrients. Only about 10% of energy passes to the next level."),
            ]),
        ],
    },
    {
        "course": "CHM 101", "title": "Chemistry Foundations", "topic": "Atomic Structure", "difficulty": "beginner", "minutes": 18, "icon": "flask-conical",
        "description": "Atoms, the periodic table, bonding, balancing equations and acids — clear and exam-ready.",
        "summary": ["Atomic number = protons; mass number = protons + neutrons.", "Same group → same number of outer electrons.", "Ionic = transfer of electrons; covalent = sharing.", "Acid + alkali → salt + water."],
        "sections": [
            ("Atoms", [
                _l("Protons: +1, in the nucleus.", "Neutrons: no charge, in the nucleus.", "Electrons: −1, in shells around the nucleus."),
                _p("Mass number = protons + neutrons (11 p + 12 n = 23). Isotopes have the same protons but different neutrons."),
            ]),
            ("The periodic table", [
                _p("Groups are columns; elements in a group have the same number of outer electrons and react similarly. Group 1 metals get more reactive going down. Group 0 noble gases are unreactive."),
            ]),
            ("Bonding and equations", [
                _p("Ionic bonds form when metals give electrons to non-metals (NaCl). Covalent bonds are shared pairs (H₂O). Ionic compounds have high melting points because of strong forces between ions."),
                _ex("Balancing: 2H₂ + O₂ → 2H₂O — 4 hydrogen and 2 oxygen atoms on each side."),
                _p("Exothermic reactions give out heat; catalysts speed reactions by lowering activation energy."),
            ]),
            ("Acids and bases", [
                _p("pH below 7 is acidic, 7 is neutral, above 7 is alkaline. Acids release H⁺ ions. Litmus turns red in acid and blue in alkali. Neutralisation: acid + alkali → salt + water."),
            ]),
        ],
    },
    {
        "course": "PHY 101", "title": "Physics Formulas Made Simple", "topic": "Motion", "difficulty": "intermediate", "minutes": 16, "icon": "atom",
        "description": "Speed, acceleration, Newton's laws, energy, electricity and waves with worked examples.",
        "summary": ["speed = distance ÷ time; a = (v − u) ÷ t.", "F = ma; weight = mg.", "KE = ½mv²; W = F × d; power in watts.", "V = IR; series resistances add; v = fλ."],
        "sections": [
            ("Motion", [_p("Speed = distance ÷ time. Acceleration = change in velocity ÷ time."), _ex("2 m/s to 10 m/s in 4 s → a = 8 ÷ 4 = 2 m/s².")]),
            ("Forces", [_p("Newton's second law: F = m × a. Weight = mass × g (about 10 N/kg on Earth). Third law: every action has an equal and opposite reaction. Force is measured in newtons.")]),
            ("Energy and power", [_p("Kinetic energy = ½mv². Work done = force × distance. Power = energy per second, measured in watts."), _ex("2 kg at 3 m/s → KE = ½ × 2 × 9 = 9 J.")]),
            ("Electricity and waves", [_p("V = I × R. Current is in amperes. In series, resistances add. Rubber insulates; copper conducts. Wave speed = frequency × wavelength. Light refracts when it changes medium; sound cannot cross a vacuum.")]),
        ],
    },
    {
        "course": "CSC 101", "title": "How Computers Think", "topic": "Number Systems", "difficulty": "beginner", "minutes": 15, "icon": "cpu",
        "description": "Hardware, binary and hex, algorithms, networks and your first lines of code.",
        "summary": ["CPU executes instructions; RAM is volatile.", "8 bits = 1 byte; 1010₂ = 10; F₁₆ = 15.", "Binary search halves a sorted list each step.", "HTTPS is encrypted; % gives the remainder."],
        "sections": [
            ("Hardware and software", [_p("Input devices (keyboard, mouse) send data in; output devices (monitor, printer) send it out. The CPU executes instructions. RAM is volatile memory. Operating systems such as Windows, macOS and Linux manage the hardware.")]),
            ("Binary and hexadecimal", [_p("Binary place values are 8, 4, 2, 1. 1010 = 8 + 2 = 10; 7 = 111. One byte is 8 bits. Hex digits run 0–9 then A–F, where F = 15.")]),
            ("Algorithms", [_p("An algorithm is a step-by-step solution. Binary search works on sorted data and halves the list each comparison — about 10 steps for 1,024 items. In flowcharts, a diamond is a decision.")]),
            ("Networks and code", [_p("A LAN covers one building; the internet is a WAN. HTTPS encrypts web traffic. Phishing tries to trick you into revealing details. In code, variables store values, loops repeat, and % gives the remainder (17 % 5 = 2).")]),
        ],
    },
]
