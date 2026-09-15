import { db } from "@/db";
import { users, texts, words, speedSettings, readingSessions } from "@/db/schema";
import { hashSync } from "bcryptjs";
import { desc } from "drizzle-orm";

const DEMO_TEXTS = [
  {
    title: "The Benefits of Deep Reading",
    sourceUrl: "https://example.com/deep-reading",
    content: `Reading is one of the most powerful tools for personal growth and intellectual development. When we engage in deep reading, we not only absorb information but also develop empathy, critical thinking skills, and a broader understanding of the world around us.

Research has shown that regular reading can significantly improve cognitive function. Studies indicate that people who read regularly maintain better memory function as they age and show greater neural connectivity in brain regions associated with language and comprehension.

The act of reading fiction specifically has been linked to increased empathy and social intelligence. When we immerse ourselves in a story, we experience the emotions and perspectives of characters different from ourselves, which helps us develop a more nuanced understanding of human nature.

In our digital age, the ability to focus deeply on long-form content is becoming increasingly rare. Many people find their attention spans fragmented by constant notifications and the rapid-fire nature of social media. Deep reading provides a counterbalance to this trend, training our minds to sustain attention for extended periods.

Speed reading techniques can be valuable tools when used appropriately. While comprehension should never be sacrificed for speed, developing the ability to process text more efficiently can help us consume more content and stay informed on important topics. The key is finding the right balance between pace and understanding.

Reading also serves as an excellent stress reliever. A good book can transport us to different worlds, provide escape from daily pressures, and offer new perspectives on our own challenges. The immersive nature of reading allows our minds to relax while remaining actively engaged.

To build a strong reading habit, experts recommend setting aside dedicated time each day, even if it's just fifteen or twenty minutes. Consistency matters more than duration. Choosing books that genuinely interest us, rather than what we think we should read, makes the habit easier to maintain.

The digital revolution has made books more accessible than ever. E-readers, audiobooks, and online libraries have removed many of the barriers that once made reading difficult for people with busy schedules or limited access to physical bookstores and libraries.

Ultimately, reading remains one of the most rewarding activities we can pursue. It enriches our minds, expands our horizons, and connects us to the accumulated wisdom of generations. Whether we read for knowledge, entertainment, or personal growth, the benefits are profound and lasting.`,
  },
  {
    title: "Understanding Speed Reading Techniques",
    sourceUrl: "https://example.com/speed-reading",
    content: `Speed reading is a collection of methods used to increase reading speed without significantly reducing comprehension. While some claims about speed reading may be exaggerated, there are legitimate techniques that can help most readers process text more efficiently.

The foundation of speed reading lies in understanding how our eyes and brain process written text. When we read, our eyes make small jumps called saccades, stopping briefly at each point to process information. These stops are called fixations. The average reader makes about three fixations per second, with each fixation covering about one quarter of a line of text.

One of the most effective techniques for increasing reading speed is minimizing subvocalization, which is the inner voice that pronounces each word as we read. While this habit helps with comprehension, especially for complex material, it limits reading speed to roughly the speed of speech, which averages around 150 to 250 words per minute.

Skilled speed readers learn to recognize words and phrases as visual patterns rather than sounding them out internally. This visual recognition allows the brain to process multiple words simultaneously, significantly increasing reading rate.

Another important technique involves expanding peripheral vision. Most readers focus on individual words, but effective speed readers train themselves to see groups of words at once, a practice sometimes called chunking. By reading chunks of three to five words at a time, readers can cover more text with each eye movement.

Reducing regression, or the tendency to re-read passages, is also crucial for speed improvement. Many readers habitually jump back to previous sentences or paragraphs, either consciously or unconsciously. Becoming aware of this habit and minimizing it can dramatically increase reading speed.

Using a pacer, such as a finger or pen, to guide eye movements can help maintain consistent speed and reduce unnecessary eye movements. The pacer should move at a steady pace slightly faster than comfortable reading speed, encouraging the eyes to keep up.

Practice is essential for developing speed reading skills. Like any cognitive skill, speed reading improves with regular training. Starting with easier material and gradually progressing to more challenging texts allows readers to build confidence and technique.

It is important to note that different types of reading require different speeds. Technical manuals, complex academic papers, and legal documents may require slower, more careful reading. Fiction, news articles, and general nonfiction can often be read more quickly without sacrificing comprehension.

The ultimate goal of speed reading is not simply to read faster, but to read more efficiently. By matching reading speed to the purpose and difficulty of the material, readers can optimize both their time and their understanding.`,
  },
  {
    title: "Building Better Reading Habits",
    sourceUrl: "https://example.com/reading-habits",
    content: `Developing strong reading habits is one of the best investments you can make in yourself. Like any habit, reading becomes easier and more rewarding when it becomes part of your daily routine. The key is to make reading accessible, enjoyable, and consistent.

Start by creating a dedicated reading space in your home. This doesn't need to be elaborate, a comfortable chair near a good light source with a small table for your book or reading device can make a significant difference. Having a designated spot signals to your brain that it's time to focus on reading.

Set realistic goals that you can actually achieve. Trying to read for an hour each day when you currently read nothing will likely lead to frustration and abandonment of the habit. Instead, begin with just ten or fifteen minutes daily and gradually increase the duration as the habit solidifies.

Carry reading material with you wherever you go. Whether it's a physical book, an e-reader, or a reading app on your phone, having something to read during waiting times, commutes, or breaks turns otherwise wasted moments into valuable reading time.

Choose books that genuinely interest you rather than books you think you should read. While it's fine to challenge yourself occasionally, reading should ultimately be enjoyable. If you're not enjoying a book, it's okay to put it down and find something more engaging.

Track your reading progress to stay motivated. Many readers find that keeping a simple log of books read, pages completed, or minutes spent reading provides a sense of accomplishment and helps maintain momentum.

Join a book club or find reading partners to add social accountability to your reading habit. Discussing books with others can deepen your understanding and make reading more engaging. Online communities and local libraries often have reading groups that welcome new members.

Reduce distractions during reading time. Turn off notifications, put your phone in another room, and create an environment conducive to focused attention. The quality of your reading time matters as much as the quantity.

Mix up your reading material to keep things fresh. Alternate between fiction and nonfiction, try different genres, and explore topics you might not normally choose. Variety prevents boredom and exposes you to new ideas and perspectives.

Remember that building a reading habit is a marathon, not a sprint. There will be days when you don't read, and that's perfectly fine. What matters is returning to the habit consistently over time. The compound effect of daily reading, even in small doses, leads to remarkable results over months and years.`,
  },
  {
    title: "The Science of Attention and Focus",
    sourceUrl: "https://example.com/attention",
    content: `Attention is the cognitive process that allows us to focus on specific aspects of our environment while ignoring others. Understanding how attention works can help us optimize our reading, learning, and overall cognitive performance.

The human attentional system has evolved to help us survive by detecting important information in our environment. In modern life, however, we face an unprecedented amount of information competing for our attention. Learning to manage our attention effectively has become one of the most important skills of the twenty-first century.

Research in cognitive psychology has identified several types of attention. Selective attention allows us to focus on relevant information while filtering out distractions. Sustained attention is the ability to maintain focus over extended periods. Divided attention refers to the ability to attend to multiple tasks simultaneously, though research suggests true multitasking is largely a myth.

The concept of flow, introduced by psychologist Mihaly Csikszentmihalyi, describes a state of complete immersion in an activity. During flow, people experience deep concentration, loss of self-consciousness, and a sense of control over the activity. Reading can induce flow states when the material is engaging and the reader has sufficient skill to handle the content without frustration.

Digital devices have fundamentally changed how we allocate our attention. Constant notifications, infinite scroll interfaces, and algorithmic content delivery systems are designed to capture and hold our attention. While these technologies offer benefits, they can also fragment our attention and reduce our capacity for sustained focus.

The practice of mindfulness meditation has been shown to improve attentional control. Regular meditation strengthens the brain's ability to sustain focus and resist distraction. Even brief daily meditation practice can produce measurable improvements in attention within a few weeks.

Physical factors also influence attention. Sleep deprivation significantly impairs attentional capacity, as do hunger, dehydration, and lack of physical activity. Taking care of basic physical needs creates a foundation for optimal cognitive performance.

Environmental factors play a role as well. Noise, visual clutter, and interruptions can all disrupt attention. Creating a clean, quiet workspace and minimizing potential interruptions helps maintain focus during reading and other cognitively demanding activities.

The Pomodoro technique, which involves working in focused twenty-five minute intervals followed by brief breaks, can help maintain attention by preventing mental fatigue. Regular breaks allow the brain to recover and return to tasks with renewed focus.

Ultimately, attention is a finite resource that we must manage wisely. By understanding how attention works and implementing strategies to protect and enhance our focus, we can improve our reading effectiveness and our overall cognitive performance in an increasingly distracting world.`,
  },
  {
    title: "The Joy of Reading Fiction",
    sourceUrl: "https://example.com/fiction-reading",
    content: `Fiction reading offers unique benefits that extend far beyond simple entertainment. When we read novels, stories, and other fictional works, we engage in an activity that exercises our imagination, develops our emotional intelligence, and provides insights into the human experience.

Stories have been central to human culture since the dawn of civilization. Before written language, humans gathered around fires to share tales of heroes, tragedies, and adventures. These stories helped communities make sense of the world, transmit values across generations, and provide comfort during difficult times. Reading fiction continues this ancient tradition in a deeply personal way.

One of the most significant benefits of fiction reading is the development of empathy. When we read about characters from different backgrounds, cultures, and life circumstances, we experience their emotions and perspectives from the inside. This vicarious experience can increase our understanding and compassion for real people who differ from us.

Fiction also exercises our creative imagination. Unlike nonfiction, which presents facts and arguments, fiction asks readers to construct mental images of characters, settings, and events. This active imaginative engagement strengthens our creative thinking abilities and can enhance problem-solving skills in other areas of life.

The emotional journey that fiction provides can be deeply therapeutic. Reading about characters who face challenges similar to our own can provide comfort and validation. Seeing characters overcome adversity can inspire hope and resilience. The safe space of fiction allows us to explore difficult emotions and situations without real-world consequences.

Good fiction combines compelling characters, engaging plots, and evocative language to create immersive experiences. The best novels can transport us completely into different worlds and times, providing mental travel that rivals actual travel in its ability to broaden our perspectives.

Different genres of fiction offer different benefits. Literary fiction often explores complex psychological themes and beautiful language. Science fiction and fantasy expand our thinking about possibilities and challenge our assumptions about reality. mysteries and thrillers engage our problem-solving skills. Historical fiction combines entertainment with education about past eras.

Reading fiction regularly can improve vocabulary and language skills. Exposure to well-written prose expands our own linguistic repertoire and improves our ability to express ourselves. The varied sentence structures and vocabulary found in quality fiction provide a rich model for our own writing and communication.

Despite the many benefits of fiction reading, some people feel guilty about reading for pleasure rather than for self-improvement. This guilt is misplaced. Reading fiction develops qualities that are valuable in themselves and in service of other goals. Empathy, creativity, emotional intelligence, and language skills all contribute to success and satisfaction in life.

In a world that often values productivity above all else, reading fiction reminds us of the importance of imagination, emotional depth, and the rich complexity of human experience. It offers a kind of mental and emotional travel that is uniquely valuable and increasingly rare in our distracted age.`,
  },
];

async function seed() {
  console.log("Seeding database...");

  // Create demo user
  const passwordHash = hashSync("demo123", 12);
  const [user] = await db.insert(users).values({
    email: "reader@wordrunner.app",
    passwordHash,
    name: "Alex McKenzie",
  }).returning();
  console.log("Created user:", user.email);

  // Create speed settings for the user
  await db.insert(speedSettings).values({
    userId: user.id,
    baseWpm: 350,
    wordsPerChunk: 4,
    highlightOpacity: 0.35,
  });

  // Create texts and words
  for (const textData of DEMO_TEXTS) {
    const [text] = await db.insert(texts).values({
      userId: user.id,
      title: textData.title,
      sourceUrl: textData.sourceUrl,
      content: textData.content,
      wordCount: textData.content.split(/\s+/).filter((w: string) => w.length > 0).length,
    }).returning();

    // Create words for each text
    const wordList = textData.content.split(/\s+/).filter((w: string) => w.length > 0);
    const wordsToInsert = wordList.map((word, index) => ({
      textId: text.id,
      index,
      word: word.replace(/[^a-zA-Z0-9'-]/g, ""),
      startTime: index * 0.25,
      endTime: (index + 1) * 0.25,
      isKnown: Math.random() > 0.8 ? 1 : 0,
    }));

    // Insert words in batches
    const batchSize = 100;
    for (let i = 0; i < wordsToInsert.length; i += batchSize) {
      const batch = wordsToInsert.slice(i, i + batchSize);
      await db.insert(words).values(batch);
    }

    console.log(`Created text: "${text.title}" with ${text.wordCount} words`);
  }

  // Create some reading sessions
  const textsResult = await db.select().from(texts);

  for (let i = 0; i < 5; i++) {
    const text = textsResult[i % textsResult.length];
    const duration = Math.floor(Math.random() * 1200000) + 180000; // 3-23 minutes
    const wordsRead = Math.floor(Math.random() * text.wordCount * 0.8) + 50;
    const wpm = Math.round(wordsRead / (duration / 60000));

    await db.insert(readingSessions).values({
      userId: user.id,
      textId: text.id,
      wpm: Math.min(wpm, 1200),
      wordsRead,
      durationMs: duration,
      completed: Math.random() > 0.4 ? 1 : 0,
    });
  }

  console.log("Seeded reading sessions");
  console.log("Seed complete!");
}

seed().catch(console.error);
