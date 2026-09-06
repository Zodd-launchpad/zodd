// Small wordlist just to generate the internal wallet's "12 words" for the
// demo. In production this gets replaced by real BIP-39 if the internal
// wallet is ever meant to be a real Zcash wallet (today it isn't: it's just
// a login, same as SHLD.fun).
export const DEMO_WORDLIST = [
  "auto","episode","blast","vacant","glove","devote","artefact","brick","all",
  "shallow","seven","luxury","motor","cactus","ember","filter","grain","harbor",
  "index","jungle","kernel","lumen","mango","nectar","orbit","pencil","quartz",
  "raven","summit","tundra","umbrella","velvet","willow","xenon","yield","zephyr",
];

export function generateTwelveWords(): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    out.push(DEMO_WORDLIST[Math.floor(Math.random() * DEMO_WORDLIST.length)]);
  }
  return out;
}
