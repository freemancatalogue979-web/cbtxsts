"""Starter content: English Language and General Mathematics.

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
        ("Grammar", M, "Choose the correct option: \"Each of the players ___ a new kit.\"", "have", "has", "are having", "were having", "B", "\"Each\" is singular, so it takes a singular verb: each of the players has."),
        ("Grammar", E, "Which word is a conjunction? \"I wanted to go, but it was raining.\"", "wanted", "go", "but", "raining", "C", "Conjunctions join clauses. \"But\" links the two ideas and shows contrast."),
        ("Grammar", H, "Identify the correct sentence.", "Whom is calling?", "Who is calling?", "Whose is calling?", "Who's is calling?", "B", "\"Who\" is the subject of the verb \"is calling\". \"Whom\" is only used as an object."),
        ("Vocabulary", E, "Choose the word closest in meaning to \"enormous\".", "tiny", "huge", "narrow", "fragile", "B", "Enormous means very large — a synonym of huge."),
        ("Vocabulary", M, "Which word means \"happening every year\"?", "biannual", "annual", "perennial", "monthly", "B", "Annual means once a year. Biannual means twice a year."),
        ("Vocabulary", H, "\"Her argument was cogent.\" Cogent means:", "confusing", "clear, logical and convincing", "extremely long", "rude", "B", "A cogent argument is clear and persuasive."),
        ("Punctuation", E, "Which sentence needs a question mark?", "Close the door", "I wonder why she left", "Where did you put my keys", "She asked where I was", "C", "Only a direct question ends with a question mark. Indirect questions (\"she asked where…\") do not."),
        ("Punctuation", M, "Choose the correct possessive: \"The ___ books were left on the bus.\" (more than one child)", "childs'", "childrens'", "children's", "childrens", "C", "\"Children\" is already plural, so add 's for possession: children's."),
        ("Figures of Speech", E, "\"Buzz\", \"sizzle\" and \"crash\" are examples of:", "onomatopoeia", "metaphor", "irony", "simile", "A", "Onomatopoeia: words that imitate the sound they describe."),
        ("Figures of Speech", H, "A fire station burning down is an example of:", "hyperbole", "situational irony", "alliteration", "personification", "B", "Situational irony is when the outcome is the opposite of what we expect."),
        ("Comprehension Skills", E, "What is the purpose of a summary?", "to add new opinions", "to give the main points briefly", "to copy the whole text", "to list every example", "B", "A summary keeps only the main ideas, in fewer words than the original."),
        ("Comprehension Skills", M, "A word's meaning worked out from the sentences around it is found using:", "context clues", "a footnote", "the index", "punctuation only", "A", "Context clues are the surrounding words that hint at a new word's meaning."),
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
        ("Number & Arithmetic", E, "What is 15% written as a decimal?", "1.5", "0.15", "0.015", "15.0", "B", "Divide by 100: 15 ÷ 100 = 0.15."),
        ("Number & Arithmetic", M, "What is the highest common factor (HCF) of 18 and 24?", "3", "6", "12", "72", "B", "Factors of 18: 1, 2, 3, 6, 9, 18. Factors of 24: 1, 2, 3, 4, 6, 8, 12, 24. The highest shared is 6."),
        ("Number & Arithmetic", H, "Evaluate 2³ × 2²", "2⁵ = 32", "2⁶ = 64", "4⁵", "10", "A", "When multiplying powers of the same base, add the indices: 2³ × 2² = 2⁵ = 32."),
        ("Algebra", E, "Simplify 3a + 2a − a", "4a", "5a", "6a", "3a", "A", "Collect like terms: 3 + 2 − 1 = 4, so 4a."),
        ("Algebra", M, "If 5x + 3 = 2x + 15, what is x?", "3", "4", "6", "12", "B", "Subtract 2x: 3x + 3 = 15. Subtract 3: 3x = 12. Divide by 3: x = 4."),
        ("Algebra", H, "Expand (x + 4)(x − 2)", "x² + 2x − 8", "x² − 2x − 8", "x² + 6x − 8", "x² − 8", "A", "x·x + x·(−2) + 4·x + 4·(−2) = x² − 2x + 4x − 8 = x² + 2x − 8."),
        ("Geometry", E, "How many sides does a pentagon have?", "4", "5", "6", "8", "B", "A pentagon has five sides."),
        ("Geometry", M, "What is the volume of a cube with side 3 cm?", "9 cm³", "18 cm³", "27 cm³", "12 cm³", "C", "Volume of a cube = side³ = 3 × 3 × 3 = 27 cm³."),
        ("Fractions & Percentages", M, "Simplify 18/24 fully.", "9/12", "3/4", "2/3", "6/8", "B", "Divide top and bottom by the HCF, 6: 18 ÷ 6 = 3 and 24 ÷ 6 = 4, so 3/4."),
        ("Fractions & Percentages", H, "Increase 200 by 12%.", "212", "224", "240", "2400", "B", "12% of 200 = 24, so 200 + 24 = 224 (or 200 × 1.12)."),
        ("Statistics & Probability", M, "Find the range of 4, 11, 7, 2, 9.", "7", "9", "11", "6.6", "B", "Range = largest − smallest = 11 − 2 = 9."),
        ("Statistics & Probability", H, "Two fair coins are tossed. What is the probability of getting two heads?", "1/2", "1/3", "1/4", "3/4", "C", "Outcomes: HH, HT, TH, TT. Only one of four is HH, so 1/4."),
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
                _k("Conjunction", "Joins words or clauses: and, but, because, although."),
                _ex("In \"They finished the project early\": They = pronoun, finished = verb, project = noun, early = adverb."),
            ]),
            ("Subject–verb agreement", [
                _p("The verb must agree with its subject in number. Singular subject → singular verb; plural subject → plural verb."),
                _l("Find the real subject — ignore phrases like \"of items\": The list of items IS on the desk.", "Third-person singular present verbs take -s: she goes, he writes.", "Each, every, everyone and nobody are singular: Each of the players HAS a kit.", "Who is a subject (Who is calling?); whom is an object (To whom did you write?).", "Neither…nor / either…or: the verb agrees with the nearer subject: Neither the teacher nor the students WERE ready."),
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
                _k("HCF and LCM", "HCF = the highest number that divides both (18 and 24 → 6). LCM = the smallest number both divide into (4 and 6 → 12)."),
                _k("Index laws", "Multiply powers of the same base by adding the indices: 2³ × 2² = 2⁵ = 32."),
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
                _l("Rectangle: area = length × width.", "Cube: volume = side³ (3 cm → 27 cm³).", "Circle: circumference C = 2πr, area A = πr².", "Right-angled triangle: c² = a² + b² (c is the hypotenuse)."),
                _ex("Sides 6 and 8: c² = 36 + 64 = 100, so c = 10."),
            ]),
            ("Fractions and percentages", [
                _p("Add fractions with a common denominator: 1/2 + 1/4 = 2/4 + 1/4 = 3/4. Convert a fraction to a decimal by dividing: 3/8 = 0.375."),
                _p("Simplify a fraction by dividing top and bottom by their HCF: 18/24 = 3/4. To increase by a percentage, add it on: 200 + 12% = 200 × 1.12 = 224."),
                _p("Percentage change = change ÷ original × 100. Always divide by the ORIGINAL value."),
                _ex("£40 → £50 is a £10 rise; 10 ÷ 40 × 100 = 25% increase."),
            ]),
            ("Averages and probability", [
                _k("Mean", "Total ÷ number of values."), _k("Median", "Middle value when the data are in order."), _k("Mode", "Most frequent value."), _k("Range", "Largest value minus smallest value."),
                _p("Probability = favourable outcomes ÷ total outcomes. Two coins: HH, HT, TH, TT → P(two heads) = 1/4."),
            ]),
        ],
    },
]
