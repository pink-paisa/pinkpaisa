export type BusinessListing = {
  id: string;
  name: string;
  category: string;
  description?: string;
  email: string;
  phone: string;
  featured?: boolean;
  verified?: boolean;
  image?: string;
};

export const categories = [
  "All",
  "Bakery",
  "Restaurant",
  "Clothing",
  "Educational services",
  "Medical care",
  "Art dealers and galleries",
  "Pharma",
];

export const businesses: BusinessListing[] = [
  {
    id: "1",
    name: "Ravi Bakers",
    category: "Bakery",
    email: "ravibohra908@gmail.com",
    phone: "7947275153",
  },
  {
    id: "2",
    name: "Madhurima Bakers",
    category: "Bakery",
    email: "madhurimabakers@gmail.com",
    phone: "7947209975",
  },
  {
    id: "3",
    name: "Jamuns Bakery",
    category: "Bakery",
    email: "yamini20091996@gmail.com",
    phone: "7947082000",
  },
  {
    id: "4",
    name: "JNM Studio",
    category: "Art dealers and galleries",
    description: "Art Work",
    email: "nainism141@gmail.com",
    phone: "9833036661",
  },
  {
    id: "5",
    name: "Laxmi Kasbekar",
    category: "Medical care",
    description: "Investment advisor & Modicare consultant",
    email: "laxmi.kasbekar@gmail.com",
    phone: "9022520488",
    verified: true,
  },
  {
    id: "6",
    name: "Narula Bakery By Sk Cakes",
    category: "Bakery",
    email: "narulabakerynb@gmail.com",
    phone: "7947213893",
  },
  {
    id: "7",
    name: "The House Of Cake Bouques",
    category: "Bakery",
    email: "gunjan.khera.abvp@gmail.com",
    phone: "8383870675",
  },
  {
    id: "8",
    name: "Bhartiya Bakery",
    category: "Bakery",
    email: "bhartiyabakery@gmail.com",
    phone: "1412316439",
  },
  {
    id: "9",
    name: "Jojo's Bakery Cafe",
    category: "Bakery",
    email: "swatidhawan1993@gmail.com",
    phone: "1140254256",
  },
  {
    id: "10",
    name: "Phonics Forum",
    category: "Educational services",
    description: "Storytelling, picture talk, phonics (3–6 yrs), creative writing & grammar (6–9 yrs), English conversation",
    email: "shahforum702004@yahoo.com",
    phone: "9819002048",
    featured: true,
    verified: true,
  },
  {
    id: "11",
    name: "Devs Bakery & Cafe",
    category: "Bakery",
    email: "bengali@devsbakery.in",
    phone: "7316515151",
  },
  {
    id: "12",
    name: "Krussty Dough",
    category: "Restaurant",
    description: "Italian Pizzas — Oven Fresh sourdough pizza brought to the comfort of your home! PURE VEG/JAIN",
    email: "dimps_79@hotmail.com",
    phone: "9833690009",
    featured: true,
    verified: true,
  },
  {
    id: "13",
    name: "A4 Foods",
    category: "Bakery",
    email: "a4foods@gmail.com",
    phone: "9831448800",
  },
  {
    id: "14",
    name: "Yummy Puds",
    category: "Bakery",
    email: "parwati.mohta@gmail.com",
    phone: "9830963104",
  },
  {
    id: "15",
    name: "Sinful Delights",
    category: "Bakery",
    email: "divyajalan04@gmail.com",
    phone: "9831004272",
  },
  {
    id: "16",
    name: "Fluffy Treat",
    category: "Bakery",
    email: "neha.golchha87@gmail.com",
    phone: "9007771762",
  },
  {
    id: "17",
    name: "Kathleen Confectioners",
    category: "Bakery",
    email: "rini.manjushree@gmail.com",
    phone: "3354039892",
  },
  {
    id: "18",
    name: "Cake Street",
    category: "Bakery",
    email: "vamigoscafe@gmail.com",
    phone: "7947182232",
  },
  {
    id: "19",
    name: "Oriental Lilies",
    category: "Clothing",
    description: "Exclusive Handcrafted ethnic collection",
    email: "Orientallilies@gmail.com",
    phone: "488413272",
    featured: true,
  },
  {
    id: "20",
    name: "Haven's Cafe",
    category: "Bakery",
    email: "shivani.gupta46@gmail.com",
    phone: "2229660069",
  },
  {
    id: "21",
    name: "Cocoa Patisserie & Bakery",
    category: "Bakery",
    email: "amrita0801@hotmail.com",
    phone: "8975226174",
  },
  {
    id: "22",
    name: "Pharmaceuticals (Shloka)",
    category: "Pharma",
    description: "Pharmaceuticals Masters Graduate",
    email: "Shloka290897@gmail.com",
    phone: "488622833",
  },
];
