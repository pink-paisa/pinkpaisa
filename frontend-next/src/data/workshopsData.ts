import { Clock, Users, Briefcase, Heart, Brain, Dumbbell, MessageCircle, Shield, Flame, Compass, Zap, Award } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type WorkshopCategory = "All" | "Corporate" | "Group" | "Bundle";

export type Workshop = {
  id: string;
  title: string;
  category: WorkshopCategory;
  duration: string;
  minPeople: number;
  price: number;
  originalPrice?: number;
  description: string;
  icon: LucideIcon;
  popular?: boolean;
  benefits?: string[];
};

export const workshopCategories: WorkshopCategory[] = ["All", "Corporate", "Group", "Bundle"];

export const workshops: Workshop[] = [
  // Bundles
  {
    id: "corp-all-11",
    title: "All 11 Corporate Modules",
    category: "Bundle",
    duration: "22 Hours",
    minPeople: 25,
    price: 1499,
    originalPrice: 660000,
    description: "Complete corporate wellness programme covering physical, emotional, social and financial wellbeing across 11 structured modules.",
    icon: Award,
    popular: true,
    benefits: ["Save ₹6,58,501", "All 11 modules included", "Certificate of completion"],
  },
  {
    id: "group-all-3",
    title: "All 3 Group Modules Combined",
    category: "Bundle",
    duration: "6 Hours",
    minPeople: 25,
    price: 1499,
    originalPrice: 90000,
    description: "Complete group wellness experience — mindfulness, resilience and nutrition in one powerful session for your squad or family.",
    icon: Award,
    benefits: ["Save ₹88,501", "All 3 modules included", "Group certificate"],
  },

  // Corporate workshops
  {
    id: "corp-yoga",
    title: "Physical Wellness – Office Yoga, Movement & Breathing",
    category: "Corporate",
    duration: "2 Hours",
    minPeople: 25,
    price: 1499,
    description: "Desk-friendly yoga sequences, conscious breathing techniques, and movement patterns to combat sedentary work culture.",
    icon: Dumbbell,
  },
  {
    id: "corp-sleep",
    title: "Stress vs Sleep & Relaxation",
    category: "Corporate",
    duration: "2 Hours",
    minPeople: 25,
    price: 1499,
    description: "Understand the stress-sleep cycle and learn actionable relaxation techniques to improve recovery and performance.",
    icon: Heart,
    popular: true,
  },
  {
    id: "corp-nutrition",
    title: "Nutrition and Health",
    category: "Corporate",
    duration: "2 Hours",
    minPeople: 25,
    price: 1499,
    description: "Practical nutrition guidance for busy professionals — meal planning, energy management and mindful eating habits.",
    icon: Zap,
  },
  {
    id: "corp-emotional",
    title: "Emotional Wellness",
    category: "Corporate",
    duration: "2 Hours",
    minPeople: 25,
    price: 1499,
    description: "Build emotional intelligence, understand triggers, and develop healthy coping mechanisms in the workplace.",
    icon: Heart,
  },
  {
    id: "corp-anger",
    title: "Managing Emotions & Anger Management",
    category: "Corporate",
    duration: "2 Hours",
    minPeople: 25,
    price: 1499,
    description: "Tools and frameworks for constructive emotional expression, conflict resolution, and maintaining composure under pressure.",
    icon: Flame,
  },
  {
    id: "corp-mindfulness",
    title: "Mindfulness – Mental Health",
    category: "Corporate",
    duration: "2 Hours",
    minPeople: 25,
    price: 1499,
    description: "Introduction to mindfulness practices that reduce anxiety, improve focus, and build mental clarity for peak performance.",
    icon: Brain,
  },
  {
    id: "corp-resilience",
    title: "Resilience",
    category: "Corporate",
    duration: "2 Hours",
    minPeople: 25,
    price: 1499,
    description: "Develop the ability to bounce back from setbacks, adapt to change, and thrive through challenges in your career.",
    icon: Shield,
  },
  {
    id: "corp-social",
    title: "Social Wellness – Relationships",
    category: "Corporate",
    duration: "2 Hours",
    minPeople: 25,
    price: 1499,
    description: "Build meaningful workplace relationships, strengthen team bonds, and develop healthy social boundaries.",
    icon: Users,
  },
  {
    id: "corp-communication",
    title: "Effective Communication",
    category: "Corporate",
    duration: "2 Hours",
    minPeople: 25,
    price: 1499,
    description: "Master assertive communication, active listening, and the art of giving and receiving constructive feedback.",
    icon: MessageCircle,
    popular: true,
  },
  {
    id: "corp-breakthrough",
    title: "Breakdown to Breakthrough",
    category: "Corporate",
    duration: "2 Hours",
    minPeople: 25,
    price: 1499,
    description: "Transform setbacks into stepping stones — a powerful workshop on reframing failure and finding growth in adversity.",
    icon: Compass,
  },
  {
    id: "corp-leadership",
    title: "Self Leadership – Esteem, Beliefs & Goal Setting",
    category: "Corporate",
    duration: "2 Hours",
    minPeople: 25,
    price: 1499,
    description: "Build self-esteem, challenge limiting beliefs, and set ambitious yet achievable goals for personal and professional growth.",
    icon: Briefcase,
  },

  // Group workshops
  {
    id: "group-mindfulness",
    title: "Mindfulness for Well-Being",
    category: "Group",
    duration: "2 Hours",
    minPeople: 25,
    price: 1499,
    description: "A guided mindfulness session for groups — explore meditation, breathing exercises, and present-moment awareness with your crew.",
    icon: Brain,
    popular: true,
  },
  {
    id: "group-resilience",
    title: "Adult Resilience",
    category: "Group",
    duration: "2 Hours",
    minPeople: 25,
    price: 1499,
    description: "Build collective resilience through shared exercises, group discussions, and resilience-building frameworks.",
    icon: Shield,
  },
  {
    id: "group-nutrition",
    title: "Self Love – Nutrition & Health",
    category: "Group",
    duration: "2 Hours",
    minPeople: 25,
    price: 1499,
    description: "A self-care session blending nutrition knowledge with self-love practices — perfect for friend groups and family gatherings.",
    icon: Heart,
  },
];

export const corporateBenefits = [
  { label: "Time Management", icon: Clock },
  { label: "Increasing Productivity", icon: Zap },
  { label: "Career Enhancements", icon: Briefcase },
  { label: "Identifying Core Strengths", icon: Compass },
  { label: "Maximizing Potential", icon: Award },
  { label: "Improving Communication", icon: MessageCircle },
];
