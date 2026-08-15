// functions/questions.ts — server-side trivia bank.
//
// The bank never leaves the server with `correct` attached during an active
// round: MatchRoom strips it when broadcasting the QUESTION phase and only
// reveals it once the round closes. This is what makes scoring tamper-proof.

export type Difficulty = "easy" | "medium" | "hard";

export type Question = {
  id: string;
  category: string;
  difficulty: Difficulty;
  text: string;
  options: string[];
  correct: number;
};

const RAW: Omit<Question, "id">[] = [
  // ---------- Science ----------
  { category: "Science", difficulty: "easy", text: "What gas do plants absorb from the atmosphere for photosynthesis?", options: ["Oxygen", "Carbon dioxide", "Nitrogen", "Hydrogen"], correct: 1 },
  { category: "Science", difficulty: "easy", text: "How many bones are in the adult human body?", options: ["186", "206", "226", "246"], correct: 1 },
  { category: "Science", difficulty: "easy", text: "What is the chemical symbol for gold?", options: ["Go", "Gd", "Au", "Ag"], correct: 2 },
  { category: "Science", difficulty: "medium", text: "Which blood type is known as the universal donor?", options: ["AB positive", "O negative", "A negative", "B positive"], correct: 1 },
  { category: "Science", difficulty: "medium", text: "What is the most abundant gas in Earth's atmosphere?", options: ["Oxygen", "Carbon dioxide", "Nitrogen", "Argon"], correct: 2 },
  { category: "Science", difficulty: "medium", text: "What particle carries a negative electric charge?", options: ["Proton", "Neutron", "Electron", "Positron"], correct: 2 },
  { category: "Science", difficulty: "hard", text: "What is the half-life of Carbon-14, approximately?", options: ["1,300 years", "5,730 years", "12,400 years", "24,100 years"], correct: 1 },
  { category: "Science", difficulty: "hard", text: "Which scientist proposed the three laws of planetary motion?", options: ["Galileo Galilei", "Isaac Newton", "Johannes Kepler", "Tycho Brahe"], correct: 2 },
  { category: "Science", difficulty: "medium", text: "What is the powerhouse of the cell?", options: ["Ribosome", "Nucleus", "Mitochondrion", "Golgi apparatus"], correct: 2 },
  { category: "Science", difficulty: "hard", text: "At what temperature are Celsius and Fahrenheit scales equal?", options: ["-40 degrees", "0 degrees", "-273 degrees", "32 degrees"], correct: 0 },
  { category: "Science", difficulty: "easy", text: "What planet is known as the Red Planet?", options: ["Venus", "Mars", "Jupiter", "Mercury"], correct: 1 },
  { category: "Science", difficulty: "medium", text: "What is the hardest naturally occurring substance on Earth?", options: ["Quartz", "Titanium", "Diamond", "Corundum"], correct: 2 },
  { category: "Science", difficulty: "hard", text: "Which element has the atomic number 79?", options: ["Silver", "Platinum", "Gold", "Mercury"], correct: 2 },
  { category: "Science", difficulty: "medium", text: "How long does light from the Sun take to reach Earth?", options: ["8 seconds", "8 minutes", "8 hours", "80 minutes"], correct: 1 },
  { category: "Science", difficulty: "hard", text: "What does DNA stand for?", options: ["Deoxyribonucleic acid", "Dinucleic acid", "Diribonucleic acid", "Deoxyribose nitrate"], correct: 0 },

  // ---------- Geography ----------
  { category: "Geography", difficulty: "easy", text: "What is the capital of Australia?", options: ["Sydney", "Melbourne", "Canberra", "Perth"], correct: 2 },
  { category: "Geography", difficulty: "easy", text: "Which is the longest river in the world?", options: ["Amazon", "Nile", "Yangtze", "Mississippi"], correct: 1 },
  { category: "Geography", difficulty: "medium", text: "Which country has the most time zones?", options: ["Russia", "United States", "France", "China"], correct: 2 },
  { category: "Geography", difficulty: "easy", text: "On which continent is the Sahara Desert located?", options: ["Asia", "Africa", "Australia", "South America"], correct: 1 },
  { category: "Geography", difficulty: "medium", text: "What is the smallest country in the world by area?", options: ["Monaco", "Nauru", "Vatican City", "San Marino"], correct: 2 },
  { category: "Geography", difficulty: "hard", text: "Which two countries share the longest international border?", options: ["Russia & China", "USA & Canada", "Chile & Argentina", "India & China"], correct: 1 },
  { category: "Geography", difficulty: "medium", text: "Mount Kilimanjaro is located in which country?", options: ["Kenya", "Tanzania", "Uganda", "Ethiopia"], correct: 1 },
  { category: "Geography", difficulty: "hard", text: "What is the deepest oceanic trench on Earth?", options: ["Puerto Rico Trench", "Java Trench", "Mariana Trench", "Tonga Trench"], correct: 2 },
  { category: "Geography", difficulty: "easy", text: "Which ocean is the largest?", options: ["Atlantic", "Indian", "Arctic", "Pacific"], correct: 3 },
  { category: "Geography", difficulty: "medium", text: "Istanbul sits on which two continents?", options: ["Europe & Asia", "Asia & Africa", "Europe & Africa", "Asia only"], correct: 0 },
  { category: "Geography", difficulty: "hard", text: "Which country is home to the ancient city of Petra?", options: ["Egypt", "Jordan", "Syria", "Lebanon"], correct: 1 },
  { category: "Geography", difficulty: "medium", text: "What is the capital of Canada?", options: ["Toronto", "Vancouver", "Ottawa", "Montreal"], correct: 2 },
  { category: "Geography", difficulty: "easy", text: "Which country is shaped like a boot?", options: ["Greece", "Italy", "Spain", "Portugal"], correct: 1 },
  { category: "Geography", difficulty: "hard", text: "Lake Baikal, the world's deepest lake, is in which country?", options: ["Mongolia", "Kazakhstan", "Russia", "China"], correct: 2 },

  // ---------- History ----------
  { category: "History", difficulty: "easy", text: "In which year did World War II end?", options: ["1943", "1944", "1945", "1946"], correct: 2 },
  { category: "History", difficulty: "medium", text: "Who was the first President of the United States?", options: ["Thomas Jefferson", "George Washington", "John Adams", "Benjamin Franklin"], correct: 1 },
  { category: "History", difficulty: "medium", text: "The Berlin Wall fell in which year?", options: ["1987", "1989", "1991", "1993"], correct: 1 },
  { category: "History", difficulty: "hard", text: "Which empire was ruled by Genghis Khan?", options: ["Ottoman Empire", "Mongol Empire", "Persian Empire", "Byzantine Empire"], correct: 1 },
  { category: "History", difficulty: "easy", text: "Who was the first person to walk on the Moon?", options: ["Buzz Aldrin", "Yuri Gagarin", "Neil Armstrong", "Michael Collins"], correct: 2 },
  { category: "History", difficulty: "hard", text: "The Rosetta Stone was key to deciphering which writing system?", options: ["Cuneiform", "Egyptian hieroglyphs", "Linear B", "Runic script"], correct: 1 },
  { category: "History", difficulty: "medium", text: "Which ancient civilization built Machu Picchu?", options: ["Aztec", "Maya", "Inca", "Olmec"], correct: 2 },
  { category: "History", difficulty: "hard", text: "In which year did the Titanic sink?", options: ["1910", "1912", "1914", "1916"], correct: 1 },
  { category: "History", difficulty: "medium", text: "Who painted the ceiling of the Sistine Chapel?", options: ["Leonardo da Vinci", "Raphael", "Michelangelo", "Donatello"], correct: 2 },
  { category: "History", difficulty: "hard", text: "The Hundred Years' War was fought between which two countries?", options: ["England & France", "Spain & Portugal", "Austria & Prussia", "Rome & Carthage"], correct: 0 },
  { category: "History", difficulty: "medium", text: "Which country gifted the Statue of Liberty to the USA?", options: ["United Kingdom", "France", "Spain", "Netherlands"], correct: 1 },
  { category: "History", difficulty: "hard", text: "Cleopatra was the last active ruler of which kingdom?", options: ["Ptolemaic Egypt", "Assyria", "Macedonia", "Nubia"], correct: 0 },

  // ---------- Pop Culture ----------
  { category: "Pop Culture", difficulty: "easy", text: "Which band released the album 'Abbey Road'?", options: ["The Rolling Stones", "The Beatles", "Pink Floyd", "The Who"], correct: 1 },
  { category: "Pop Culture", difficulty: "medium", text: "In the Harry Potter series, what is the name of Harry's owl?", options: ["Errol", "Hedwig", "Crookshanks", "Fawkes"], correct: 1 },
  { category: "Pop Culture", difficulty: "easy", text: "What is the highest-grossing animated franchise featuring a lion cub named Simba?", options: ["Madagascar", "The Lion King", "Ice Age", "Zootopia"], correct: 1 },
  { category: "Pop Culture", difficulty: "medium", text: "Who directed the movie 'Inception'?", options: ["Steven Spielberg", "Christopher Nolan", "Denis Villeneuve", "Ridley Scott"], correct: 1 },
  { category: "Pop Culture", difficulty: "hard", text: "Which video game features a character named Master Chief?", options: ["Doom", "Halo", "Destiny", "Gears of War"], correct: 1 },
  { category: "Pop Culture", difficulty: "medium", text: "What streaming series features the Upside Down?", options: ["Dark", "Stranger Things", "The OA", "Fringe"], correct: 1 },
  { category: "Pop Culture", difficulty: "easy", text: "Which superhero is known as the Dark Knight?", options: ["Superman", "Batman", "Iron Man", "Green Arrow"], correct: 1 },
  { category: "Pop Culture", difficulty: "hard", text: "Which artist painted 'The Persistence of Memory' with melting clocks?", options: ["Pablo Picasso", "Salvador Dalí", "René Magritte", "Joan Miró"], correct: 1 },
  { category: "Pop Culture", difficulty: "medium", text: "In Star Wars, what species is Chewbacca?", options: ["Ewok", "Wookiee", "Jawa", "Gungan"], correct: 1 },
  { category: "Pop Culture", difficulty: "hard", text: "Which film won the first Academy Award for Best Picture?", options: ["Wings", "Sunrise", "The Jazz Singer", "Metropolis"], correct: 0 },
  { category: "Pop Culture", difficulty: "easy", text: "What color is the Pac-Man ghost named Blinky?", options: ["Pink", "Cyan", "Red", "Orange"], correct: 2 },
  { category: "Pop Culture", difficulty: "medium", text: "Which Nintendo character is a plumber?", options: ["Link", "Mario", "Kirby", "Fox"], correct: 1 },

  // ---------- Technology ----------
  { category: "Technology", difficulty: "easy", text: "What does 'HTTP' stand for?", options: ["HyperText Transfer Protocol", "High Transfer Text Protocol", "HyperText Transmission Process", "Hosted Transfer Text Protocol"], correct: 0 },
  { category: "Technology", difficulty: "medium", text: "Who is credited with creating the Linux kernel?", options: ["Richard Stallman", "Linus Torvalds", "Ken Thompson", "Dennis Ritchie"], correct: 1 },
  { category: "Technology", difficulty: "medium", text: "What does 'API' stand for?", options: ["Applied Program Interface", "Application Programming Interface", "Automated Process Integration", "Advanced Protocol Interface"], correct: 1 },
  { category: "Technology", difficulty: "hard", text: "In binary, what is the decimal number 10?", options: ["1010", "1100", "1001", "1110"], correct: 0 },
  { category: "Technology", difficulty: "easy", text: "What company developed the Android operating system originally?", options: ["Apple", "Android Inc.", "Microsoft", "Nokia"], correct: 1 },
  { category: "Technology", difficulty: "medium", text: "Which programming language is primarily used for modern Android development?", options: ["Swift", "Kotlin", "Ruby", "Go"], correct: 1 },
  { category: "Technology", difficulty: "hard", text: "What does 'RAM' stand for?", options: ["Rapid Access Memory", "Random Access Memory", "Readable Active Memory", "Runtime Allocated Memory"], correct: 1 },
  { category: "Technology", difficulty: "medium", text: "What protocol enables full-duplex realtime communication over a single TCP connection?", options: ["HTTP/2", "WebSocket", "FTP", "SMTP"], correct: 1 },
  { category: "Technology", difficulty: "hard", text: "How many bits are in a single byte?", options: ["4", "8", "16", "32"], correct: 1 },
  { category: "Technology", difficulty: "easy", text: "What does 'Wi-Fi' primarily provide?", options: ["Wireless networking", "Wired networking", "Battery charging", "Screen mirroring only"], correct: 0 },
  { category: "Technology", difficulty: "medium", text: "Which company created the React library?", options: ["Google", "Meta", "Microsoft", "Twitter"], correct: 1 },
  { category: "Technology", difficulty: "hard", text: "What is the default port for HTTPS?", options: ["80", "443", "8080", "22"], correct: 1 },

  // ---------- Sports ----------
  { category: "Sports", difficulty: "easy", text: "How many players are on a standard soccer team on the field?", options: ["9", "10", "11", "12"], correct: 2 },
  { category: "Sports", difficulty: "medium", text: "How often are the Summer Olympic Games held?", options: ["Every 2 years", "Every 3 years", "Every 4 years", "Every 5 years"], correct: 2 },
  { category: "Sports", difficulty: "medium", text: "In tennis, what is a score of zero called?", options: ["Nil", "Love", "Duck", "Blank"], correct: 1 },
  { category: "Sports", difficulty: "hard", text: "Which country has won the most FIFA World Cup titles?", options: ["Germany", "Italy", "Brazil", "Argentina"], correct: 2 },
  { category: "Sports", difficulty: "easy", text: "How many points is a touchdown worth in American football?", options: ["3", "6", "7", "8"], correct: 1 },
  { category: "Sports", difficulty: "medium", text: "In basketball, how many points is a free throw worth?", options: ["1", "2", "3", "4"], correct: 0 },
  { category: "Sports", difficulty: "hard", text: "What is the maximum break in snooker?", options: ["141", "147", "155", "180"], correct: 1 },
  { category: "Sports", difficulty: "medium", text: "The Tour de France is primarily what kind of race?", options: ["Running", "Cycling", "Motor racing", "Rowing"], correct: 1 },
  { category: "Sports", difficulty: "hard", text: "How many rings are on the Olympic flag?", options: ["4", "5", "6", "7"], correct: 1 },

  // ---------- Nature ----------
  { category: "Nature", difficulty: "easy", text: "What is the largest mammal on Earth?", options: ["African elephant", "Blue whale", "Giraffe", "Orca"], correct: 1 },
  { category: "Nature", difficulty: "medium", text: "How many hearts does an octopus have?", options: ["1", "2", "3", "4"], correct: 2 },
  { category: "Nature", difficulty: "medium", text: "What is a group of crows called?", options: ["A flock", "A murder", "A pack", "A gaggle"], correct: 1 },
  { category: "Nature", difficulty: "hard", text: "Which animal has the longest recorded lifespan?", options: ["Galapagos tortoise", "Greenland shark", "Bowhead whale", "Ocean quahog clam"], correct: 3 },
  { category: "Nature", difficulty: "easy", text: "What is the fastest land animal?", options: ["Lion", "Cheetah", "Pronghorn", "Greyhound"], correct: 1 },
  { category: "Nature", difficulty: "medium", text: "Which bird is famous for being unable to fly and native to Antarctica?", options: ["Puffin", "Penguin", "Albatross", "Kiwi"], correct: 1 },
  { category: "Nature", difficulty: "hard", text: "What is the only mammal capable of true sustained flight?", options: ["Flying squirrel", "Bat", "Colugo", "Sugar glider"], correct: 1 },
  { category: "Nature", difficulty: "medium", text: "Bees produce honey primarily from what?", options: ["Pollen", "Nectar", "Sap", "Water"], correct: 1 },
  { category: "Nature", difficulty: "hard", text: "What is the largest species of shark?", options: ["Great white", "Tiger shark", "Whale shark", "Basking shark"], correct: 2 },

  // ---------- Arts & Words ----------
  { category: "Arts", difficulty: "medium", text: "Who wrote the play 'Romeo and Juliet'?", options: ["Charles Dickens", "William Shakespeare", "Christopher Marlowe", "Ben Jonson"], correct: 1 },
  { category: "Arts", difficulty: "hard", text: "How many strings does a standard violin have?", options: ["4", "5", "6", "7"], correct: 0 },
  { category: "Arts", difficulty: "medium", text: "Which novel begins with the line 'Call me Ishmael'?", options: ["Moby-Dick", "The Old Man and the Sea", "Treasure Island", "Robinson Crusoe"], correct: 0 },
  { category: "Arts", difficulty: "easy", text: "How many colors are in a standard rainbow?", options: ["5", "6", "7", "8"], correct: 2 },
  { category: "Arts", difficulty: "hard", text: "Who composed 'The Four Seasons'?", options: ["Johann Sebastian Bach", "Antonio Vivaldi", "Wolfgang Mozart", "Joseph Haydn"], correct: 1 },
  { category: "Arts", difficulty: "medium", text: "What does the musical term 'forte' instruct a performer to do?", options: ["Play softly", "Play loudly", "Play faster", "Play slower"], correct: 1 },
  { category: "Arts", difficulty: "hard", text: "Which artist cut off part of his own ear?", options: ["Claude Monet", "Vincent van Gogh", "Paul Gauguin", "Edgar Degas"], correct: 1 },
  { category: "Arts", difficulty: "medium", text: "In which museum is the Mona Lisa displayed?", options: ["The Prado", "The Louvre", "Uffizi Gallery", "The Met"], correct: 1 },

  // ---------- Food & Everyday ----------
  { category: "Food", difficulty: "easy", text: "What is the main ingredient in traditional guacamole?", options: ["Tomato", "Avocado", "Cucumber", "Zucchini"], correct: 1 },
  { category: "Food", difficulty: "medium", text: "Which spice is the most expensive by weight?", options: ["Vanilla", "Saffron", "Cardamom", "Cinnamon"], correct: 1 },
  { category: "Food", difficulty: "medium", text: "Sushi rice is traditionally seasoned with what?", options: ["Soy sauce", "Rice vinegar", "Sesame oil", "Mirin only"], correct: 1 },
  { category: "Food", difficulty: "hard", text: "What country did the croissant originate from?", options: ["France", "Austria", "Italy", "Belgium"], correct: 1 },
  { category: "Food", difficulty: "easy", text: "What fruit is used to make wine?", options: ["Apple", "Grape", "Pear", "Cherry"], correct: 1 },
  { category: "Food", difficulty: "hard", text: "Which nut is used to make traditional marzipan?", options: ["Hazelnut", "Almond", "Walnut", "Cashew"], correct: 1 },

  // ---------- Math & Logic ----------
  { category: "Math", difficulty: "easy", text: "What is 15% of 200?", options: ["25", "30", "35", "40"], correct: 1 },
  { category: "Math", difficulty: "medium", text: "How many degrees are in the interior angles of a triangle?", options: ["90", "180", "270", "360"], correct: 1 },
  { category: "Math", difficulty: "medium", text: "What is the value of pi rounded to two decimal places?", options: ["3.14", "3.15", "3.16", "3.12"], correct: 0 },
  { category: "Math", difficulty: "hard", text: "What is the next number in the Fibonacci sequence: 1, 1, 2, 3, 5, 8, ...?", options: ["11", "12", "13", "15"], correct: 2 },
  { category: "Math", difficulty: "hard", text: "How many sides does a dodecagon have?", options: ["10", "11", "12", "20"], correct: 2 },
  { category: "Math", difficulty: "medium", text: "What is the square root of 144?", options: ["11", "12", "13", "14"], correct: 1 },
  { category: "Math", difficulty: "hard", text: "What is 2 to the power of 10?", options: ["512", "1000", "1024", "2048"], correct: 2 },
];

export const QUESTIONS: Question[] = RAW.map((q, i) => ({ ...q, id: `q${i + 1}` }));

/** Canonical category list, derived from the bank so the two can never drift.
 * Drives the category-specific leaderboards. */
export const CATEGORIES: string[] = [...new Set(RAW.map((q) => q.category))].sort();

/**
 * Picks `count` unique questions, ordered so difficulty ramps up across the
 * match — early rounds stay approachable, late rounds get brutal.
 */
export function buildQuestionSet(count: number): Question[] {
  const byDifficulty: Record<Difficulty, Question[]> = {
    easy: shuffle(QUESTIONS.filter((q) => q.difficulty === "easy")),
    medium: shuffle(QUESTIONS.filter((q) => q.difficulty === "medium")),
    hard: shuffle(QUESTIONS.filter((q) => q.difficulty === "hard")),
  };

  const easyCount = Math.max(1, Math.round(count * 0.3));
  const hardCount = Math.max(1, Math.round(count * 0.35));
  const mediumCount = Math.max(0, count - easyCount - hardCount);

  const picked: Question[] = [
    ...take(byDifficulty.easy, easyCount),
    ...take(byDifficulty.medium, mediumCount),
    ...take(byDifficulty.hard, hardCount),
  ];

  // Top up from the whole bank if a difficulty bucket ran dry.
  if (picked.length < count) {
    const used = new Set(picked.map((q) => q.id));
    for (const q of shuffle(QUESTIONS)) {
      if (picked.length >= count) break;
      if (!used.has(q.id)) {
        used.add(q.id);
        picked.push(q);
      }
    }
  }

  return picked.slice(0, count);
}

function take<T>(pool: T[], n: number): T[] {
  return pool.slice(0, Math.min(n, pool.length));
}

function shuffle<T>(input: T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = arr[i]!;
    const b = arr[j]!;
    arr[i] = b;
    arr[j] = a;
  }
  return arr;
}
