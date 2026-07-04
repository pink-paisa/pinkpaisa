export type WealthnessType =
  | "overthinker"
  | "good-earner"
  | "safe-saver"
  | "burnt-out"
  | "ready-builder";

export type QuizOption = {
  text: string;
  scores: Record<WealthnessType, number>;
};

export type QuizQuestion = {
  id: number;
  question: string;
  options: QuizOption[];
};

export type WealthnessResult = {
  type: WealthnessType;
  title: string;
  emoji: string;
  tagline: string;
  description: string;
  strengths: string[];
  watchOuts: string[];
  nextSteps: string[];
  recommendedProduct: string;
  recommendedProductId: string;
};

export const quizQuestions: QuizQuestion[] = [
  {
    id: 1,
    question: "When you get your salary, what do you do first?",
    options: [
      { text: "Research 10 different investment options and end up doing nothing", scores: { overthinker: 3, "good-earner": 0, "safe-saver": 1, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Pay bills, shop a little, and figure out savings later", scores: { overthinker: 0, "good-earner": 3, "safe-saver": 0, "burnt-out": 1, "ready-builder": 0 } },
      { text: "Transfer a fixed amount to my savings account immediately", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 3, "burnt-out": 0, "ready-builder": 1 } },
      { text: "Feel stressed about all the EMIs and expenses ahead", scores: { overthinker: 1, "good-earner": 0, "safe-saver": 0, "burnt-out": 3, "ready-builder": 0 } },
    ],
  },
  {
    id: 2,
    question: "How do you feel when someone mentions 'investing'?",
    options: [
      { text: "Curious but overwhelmed — too many options!", scores: { overthinker: 3, "good-earner": 0, "safe-saver": 1, "burnt-out": 0, "ready-builder": 0 } },
      { text: "I know I should, but I'll get to it someday", scores: { overthinker: 0, "good-earner": 3, "safe-saver": 0, "burnt-out": 0, "ready-builder": 0 } },
      { text: "I stick to FDs and savings — why take risks?", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 3, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Excited — I want to learn and start", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 3 } },
    ],
  },
  {
    id: 3,
    question: "What's your biggest money worry right now?",
    options: [
      { text: "Making the wrong investment choice", scores: { overthinker: 3, "good-earner": 0, "safe-saver": 1, "burnt-out": 0, "ready-builder": 0 } },
      { text: "I don't really track where my money goes", scores: { overthinker: 0, "good-earner": 3, "safe-saver": 0, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Losing what I've already saved", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 3, "burnt-out": 0, "ready-builder": 0 } },
      { text: "I'm barely getting through each month", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 0, "burnt-out": 3, "ready-builder": 0 } },
    ],
  },
  {
    id: 4,
    question: "How many tabs do you open when researching a financial product?",
    options: [
      { text: "15+ and I still can't decide", scores: { overthinker: 3, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 0 } },
      { text: "I don't research — I ask friends or family", scores: { overthinker: 0, "good-earner": 2, "safe-saver": 1, "burnt-out": 1, "ready-builder": 0 } },
      { text: "I look at 2-3 safe options and pick one", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 2, "burnt-out": 0, "ready-builder": 2 } },
      { text: "I have a system — compare, decide, move on", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 3 } },
    ],
  },
  {
    id: 5,
    question: "Your friend just told you about a new investment. What do you do?",
    options: [
      { text: "Deep-dive into it for days, then get paralyzed", scores: { overthinker: 3, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Think 'I should look into that' and forget", scores: { overthinker: 0, "good-earner": 3, "safe-saver": 0, "burnt-out": 1, "ready-builder": 0 } },
      { text: "Nope, I'll stick to what I know", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 3, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Evaluate if it fits my goals, then decide", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 3 } },
    ],
  },
  {
    id: 6,
    question: "How often do you check your bank balance?",
    options: [
      { text: "Multiple times a day — anxiety!", scores: { overthinker: 2, "good-earner": 0, "safe-saver": 0, "burnt-out": 2, "ready-builder": 0 } },
      { text: "Rarely — what I don't know won't hurt me", scores: { overthinker: 0, "good-earner": 3, "safe-saver": 0, "burnt-out": 1, "ready-builder": 0 } },
      { text: "Weekly, just to make sure nothing went wrong", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 3, "burnt-out": 0, "ready-builder": 1 } },
      { text: "I have a system and review monthly", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 3 } },
    ],
  },
  {
    id: 7,
    question: "When you feel stressed, how does it affect your spending?",
    options: [
      { text: "I freeze and can't make any financial decisions", scores: { overthinker: 3, "good-earner": 0, "safe-saver": 1, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Retail therapy! I deserve it", scores: { overthinker: 0, "good-earner": 2, "safe-saver": 0, "burnt-out": 2, "ready-builder": 0 } },
      { text: "I get extra cautious and hoard cash", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 3, "burnt-out": 0, "ready-builder": 0 } },
      { text: "I try to separate emotions from money decisions", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 3 } },
    ],
  },
  {
    id: 8,
    question: "Do you have an emergency fund?",
    options: [
      { text: "I've been meaning to set one up for months", scores: { overthinker: 3, "good-earner": 1, "safe-saver": 0, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Sort of? There's some money somewhere", scores: { overthinker: 0, "good-earner": 3, "safe-saver": 0, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Yes, that's literally all I have", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 3, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Yes, and I also invest beyond it", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 3 } },
    ],
  },
  {
    id: 9,
    question: "How do you feel about SIPs (Systematic Investment Plans)?",
    options: [
      { text: "I've compared 20 mutual funds and still can't pick one", scores: { overthinker: 3, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 0 } },
      { text: "What's a SIP?", scores: { overthinker: 0, "good-earner": 2, "safe-saver": 0, "burnt-out": 2, "ready-builder": 0 } },
      { text: "Sounds risky — I'd rather keep money in savings", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 3, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Already running one or ready to start", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 3 } },
    ],
  },
  {
    id: 10,
    question: "What does a perfect Sunday look like for your finances?",
    options: [
      { text: "Spreadsheet time! But I end up more confused", scores: { overthinker: 3, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Sundays are for rest, not money stuff", scores: { overthinker: 0, "good-earner": 3, "safe-saver": 0, "burnt-out": 1, "ready-builder": 0 } },
      { text: "Quick check that my savings are intact", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 3, "burnt-out": 0, "ready-builder": 0 } },
      { text: "15-minute review and plan for the week", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 3 } },
    ],
  },
  {
    id: 11,
    question: "How would you describe your relationship with money?",
    options: [
      { text: "It's complicated — I think about it constantly", scores: { overthinker: 3, "good-earner": 0, "safe-saver": 0, "burnt-out": 1, "ready-builder": 0 } },
      { text: "Easy come, easy go", scores: { overthinker: 0, "good-earner": 3, "safe-saver": 0, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Protective — I don't like parting with it", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 3, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Healthy — it's a tool, not an emotion", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 3 } },
    ],
  },
  {
    id: 12,
    question: "When was the last time you felt truly confident about a money decision?",
    options: [
      { text: "I can't remember — every decision feels risky", scores: { overthinker: 3, "good-earner": 0, "safe-saver": 0, "burnt-out": 1, "ready-builder": 0 } },
      { text: "When I bought something that made me happy", scores: { overthinker: 0, "good-earner": 3, "safe-saver": 0, "burnt-out": 0, "ready-builder": 0 } },
      { text: "When I saw my savings account grow", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 3, "burnt-out": 0, "ready-builder": 1 } },
      { text: "Recently — I have a clear plan", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 3 } },
    ],
  },
  {
    id: 13,
    question: "Do you compare your financial situation with others?",
    options: [
      { text: "All the time — it makes me anxious", scores: { overthinker: 2, "good-earner": 0, "safe-saver": 0, "burnt-out": 2, "ready-builder": 0 } },
      { text: "Sometimes on Instagram, then I feel bad", scores: { overthinker: 0, "good-earner": 2, "safe-saver": 0, "burnt-out": 2, "ready-builder": 0 } },
      { text: "I focus on my own journey", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 2, "burnt-out": 0, "ready-builder": 2 } },
      { text: "I use others as inspiration, not comparison", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 3 } },
    ],
  },
  {
    id: 14,
    question: "How do you handle an unexpected expense?",
    options: [
      { text: "Panic and analyze every option for days", scores: { overthinker: 3, "good-earner": 0, "safe-saver": 0, "burnt-out": 1, "ready-builder": 0 } },
      { text: "Swipe the card and deal with it later", scores: { overthinker: 0, "good-earner": 3, "safe-saver": 0, "burnt-out": 1, "ready-builder": 0 } },
      { text: "Dip into my savings reluctantly", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 3, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Use my emergency fund — that's what it's for", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 3 } },
    ],
  },
  {
    id: 15,
    question: "What's your sleep like when you think about money?",
    options: [
      { text: "I lose sleep over financial decisions", scores: { overthinker: 3, "good-earner": 0, "safe-saver": 0, "burnt-out": 1, "ready-builder": 0 } },
      { text: "I avoid thinking about it before bed", scores: { overthinker: 0, "good-earner": 2, "safe-saver": 0, "burnt-out": 2, "ready-builder": 0 } },
      { text: "Fine, because I know my money is safe", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 3, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Good — I have a plan so I don't worry", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 3 } },
    ],
  },
  {
    id: 16,
    question: "If you got a ₹1 lakh bonus today, what would you do?",
    options: [
      { text: "Spend weeks deciding the 'perfect' investment", scores: { overthinker: 3, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Treat myself and maybe save some", scores: { overthinker: 0, "good-earner": 3, "safe-saver": 0, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Put it all in my savings account", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 3, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Split: some for goals, some for fun, some invested", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 3 } },
    ],
  },
  {
    id: 17,
    question: "How do you feel about your current financial knowledge?",
    options: [
      { text: "I know a lot but can't put it into action", scores: { overthinker: 3, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 0 } },
      { text: "I don't know much and haven't tried to learn", scores: { overthinker: 0, "good-earner": 2, "safe-saver": 0, "burnt-out": 2, "ready-builder": 0 } },
      { text: "I know the basics and that's enough for me", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 3, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Always learning and applying what I learn", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 3 } },
    ],
  },
  {
    id: 18,
    question: "What best describes your monthly budgeting?",
    options: [
      { text: "I make elaborate budgets but never follow them", scores: { overthinker: 3, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Budget? I just wing it", scores: { overthinker: 0, "good-earner": 3, "safe-saver": 0, "burnt-out": 1, "ready-builder": 0 } },
      { text: "I track every rupee obsessively", scores: { overthinker: 1, "good-earner": 0, "safe-saver": 3, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Simple system — automate and review monthly", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 3 } },
    ],
  },
  {
    id: 19,
    question: "What would help you most right now?",
    options: [
      { text: "Someone to just tell me what to do with my money", scores: { overthinker: 3, "good-earner": 0, "safe-saver": 0, "burnt-out": 1, "ready-builder": 0 } },
      { text: "A system to stop money from disappearing", scores: { overthinker: 0, "good-earner": 3, "safe-saver": 0, "burnt-out": 1, "ready-builder": 0 } },
      { text: "Confidence to move beyond just saving", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 3, "burnt-out": 0, "ready-builder": 0 } },
      { text: "A structured roadmap to hit my next milestone", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 3 } },
    ],
  },
  {
    id: 20,
    question: "In 5 years, where do you see your finances?",
    options: [
      { text: "I'm afraid to even think about it", scores: { overthinker: 2, "good-earner": 0, "safe-saver": 0, "burnt-out": 2, "ready-builder": 0 } },
      { text: "Hopefully better, but I have no plan", scores: { overthinker: 0, "good-earner": 3, "safe-saver": 0, "burnt-out": 1, "ready-builder": 0 } },
      { text: "Safe and stable, same as now", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 3, "burnt-out": 0, "ready-builder": 0 } },
      { text: "Growing — I have clear goals and a plan", scores: { overthinker: 0, "good-earner": 0, "safe-saver": 0, "burnt-out": 0, "ready-builder": 3 } },
    ],
  },
];

export const wealthnessResults: Record<WealthnessType, WealthnessResult> = {
  overthinker: {
    type: "overthinker",
    title: "The Overthinker",
    emoji: "🧠",
    tagline: "You know a lot — now it's time to act.",
    description:
      "You research deeply, compare endlessly, and want to make the perfect decision. But perfection becomes the enemy of progress. Your money knowledge is actually strong — what's missing is a simple system to take action without the analysis paralysis.",
    strengths: [
      "Thorough researcher",
      "Risk-aware",
      "Detail-oriented",
      "Cares deeply about getting it right",
    ],
    watchOuts: [
      "Analysis paralysis delays your wealth building",
      "Overthinking creates money anxiety",
      "Perfect becomes the enemy of good",
    ],
    nextSteps: [
      "Set a 48-hour decision rule — research, then act",
      "Start with just one SIP of ₹500",
      "Use a simple decision tree instead of comparing everything",
    ],
    recommendedProduct: "The Wealthness Starter Map",
    recommendedProductId: "starter-map",
  },
  "good-earner": {
    type: "good-earner",
    title: "The Good Earner, Poor Planner",
    emoji: "💸",
    tagline: "You're great at making money — now learn to keep it.",
    description:
      "You earn well and enjoy life, but money seems to slip through your fingers. There's no clear system for where it goes. You're not irresponsible — you just haven't built the habits and structures to make your money work as hard as you do.",
    strengths: [
      "Strong earning potential",
      "Enjoys life without guilt",
      "Optimistic about the future",
      "Open to change",
    ],
    watchOuts: [
      "No tracking means no visibility",
      "Lifestyle inflation eats your raises",
      "Future-you is depending on present-you",
    ],
    nextSteps: [
      "Set up automatic transfers on salary day",
      "Track spending for just 30 days to see patterns",
      "Create a guilt-free spending allowance",
    ],
    recommendedProduct: "30-Day Calm Money Reset",
    recommendedProductId: "calm-money",
  },
  "safe-saver": {
    type: "safe-saver",
    title: "The Safe Saver",
    emoji: "🔒",
    tagline: "You've built a safety net — now let it grow.",
    description:
      "You save diligently and protect what you have. That's a real strength. But keeping everything in savings accounts and FDs means inflation is quietly eating your wealth. You're ready for the next step — you just need the confidence to take it.",
    strengths: [
      "Disciplined saver",
      "Risk-conscious",
      "Consistent habits",
      "Financial stability",
    ],
    watchOuts: [
      "Inflation erodes savings over time",
      "Fear of loss prevents wealth growth",
      "Playing it too safe is its own risk",
    ],
    nextSteps: [
      "Learn the difference between saving and investing",
      "Start with a low-risk debt mutual fund",
      "Keep your emergency fund safe, invest the rest",
    ],
    recommendedProduct: "Your First ₹10 Lakh Playbook",
    recommendedProductId: "10-lakh",
  },
  "burnt-out": {
    type: "burnt-out",
    title: "The Burnt-Out Spender",
    emoji: "🔥",
    tagline: "You're not bad with money — you're exhausted.",
    description:
      "Financial stress, comparison anxiety, and emotional spending have left you drained. You may feel behind, but the truth is that burnout distorts your view of money. Once you address the emotional side, the financial side gets much easier.",
    strengths: [
      "Self-aware about the problem",
      "Ready for change",
      "Resilient — you've been through a lot",
      "Emotionally intelligent",
    ],
    watchOuts: [
      "Stress spending creates a vicious cycle",
      "Avoidance makes problems compound",
      "Comparison steals your progress",
    ],
    nextSteps: [
      "Start with a money mood tracker, not a budget",
      "Create one small financial win this week",
      "Unfollow accounts that trigger comparison",
    ],
    recommendedProduct: "30-Day Calm Money Reset",
    recommendedProductId: "calm-money",
  },
  "ready-builder": {
    type: "ready-builder",
    title: "The Ready-to-Invest Builder",
    emoji: "🚀",
    tagline: "You have the foundation — time to build serious wealth.",
    description:
      "You're ahead of most. You have systems, you manage emotions, and you're ready to level up. What you need now isn't basics — it's a structured roadmap to hit your next milestone and a deeper framework for goal-based investing.",
    strengths: [
      "Strong financial habits",
      "Emotionally balanced about money",
      "Goal-oriented",
      "Action-taker",
    ],
    watchOuts: [
      "Complacency can slow momentum",
      "Complexity bias — keep it simple",
      "Don't forget to enjoy the journey",
    ],
    nextSteps: [
      "Set your next wealth milestone (₹5L, ₹10L, ₹25L)",
      "Diversify across asset classes",
      "Schedule quarterly portfolio reviews",
    ],
    recommendedProduct: "Invest Without Overthinking Bootcamp",
    recommendedProductId: "bootcamp",
  },
};

export function calculateResult(answers: number[]): WealthnessType {
  const totals: Record<WealthnessType, number> = {
    overthinker: 0,
    "good-earner": 0,
    "safe-saver": 0,
    "burnt-out": 0,
    "ready-builder": 0,
  };

  answers.forEach((answerIndex, questionIndex) => {
    const question = quizQuestions[questionIndex];
    if (question && question.options[answerIndex]) {
      const scores = question.options[answerIndex].scores;
      for (const type in scores) {
        totals[type as WealthnessType] += scores[type as WealthnessType];
      }
    }
  });

  let maxType: WealthnessType = "overthinker";
  let maxScore = 0;
  for (const type in totals) {
    if (totals[type as WealthnessType] > maxScore) {
      maxScore = totals[type as WealthnessType];
      maxType = type as WealthnessType;
    }
  }

  return maxType;
}
