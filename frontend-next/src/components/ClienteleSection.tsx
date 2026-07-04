import { motion } from "framer-motion";
import sponsorZeal from "@/assets/sponsor-zeal.png";
import sponsorBlumoon from "@/assets/sponsor-blumoon.png";
import sponsorEcosolar from "@/assets/sponsor-ecosolar.png";
import sponsorPrimetech from "@/assets/sponsor-primetech.png";
import sponsorRavid from "@/assets/sponsor-ravid.png";

const clients = [
  { name: "Zeal", logo: sponsorZeal },
  { name: "Blumoon", logo: sponsorBlumoon },
  { name: "Eco Solar Australia", logo: sponsorEcosolar },
  { name: "PrimeTech", logo: sponsorPrimetech },
  { name: "Ravid", logo: sponsorRavid },
];

const ClienteleSection = () => {
  return (
    <section className="bg-cream py-16 md:py-24">
      <div className="container mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 16, filter: "blur(4px)" }}
          whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="mb-12 text-center"
        >
          <p className="mb-2 text-sm font-semibold uppercase tracking-widest text-primary">
            Trusted By
          </p>
          <h2 className="font-serif text-3xl md:text-4xl">Our Clientele</h2>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-wrap items-center justify-center gap-8 md:gap-14"
        >
          {clients.map((client, i) => (
            <motion.div
              key={client.name}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{
                duration: 0.5,
                delay: 0.1 + i * 0.08,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="grayscale opacity-70 transition-all duration-300 hover:grayscale-0 hover:opacity-100"
            >
              <img
                src={client.logo.src}
                alt={client.name}
                className="h-10 w-auto object-contain md:h-12"
              />
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

export default ClienteleSection;
