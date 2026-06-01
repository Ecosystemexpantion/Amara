import { sendMessage, sendChatAction, sendDocument, typeMessage } from "./telegram.ts";
import { advanceStep, updateStudent, incrementScreenshotAttempts, resetScreenshotAttempts, recordStepCompletion, computeNextUnlockAt, getRecentConversation } from "./db.ts";
import { geminiVision, geminiChat, buildVerificationPrompt } from "./gemini.ts";
import { modifyTemplateForStudent } from "./html-modifier.ts";
import { notifyAdmin } from "./admin.ts";
import type { Student, TelegramMessage } from "./types.ts";

// Load templates lazily and cache in module scope
let _normalTemplate: string | null = null;
let _premiumTemplate: string | null = null;

async function getNormalTemplate(): Promise<string> {
  if (!_normalTemplate) {
    try {
      _normalTemplate = await Deno.readTextFile(
        new URL("./templates/index_normal.html", import.meta.url).pathname
      );
    } catch {
      // Fallback: fetch from GitHub if file read fails
      const res = await fetch("https://raw.githubusercontent.com/Ecosystemexpantion/Amara/main/supabase/functions/amara-bot/templates/index_normal.html");
      _normalTemplate = await res.text();
    }
  }
  return _normalTemplate!;
}

async function getPremiumTemplate(): Promise<string> {
  if (!_premiumTemplate) {
    try {
      _premiumTemplate = await Deno.readTextFile(
        new URL("./templates/index_premium.html", import.meta.url).pathname
      );
    } catch {
      const res = await fetch("https://raw.githubusercontent.com/Ecosystemexpantion/Amara/main/supabase/functions/amara-bot/templates/index_premium.html");
      _premiumTemplate = await res.text();
    }
  }
  return _premiumTemplate!;
}

export async function handleDay2(
  _msg: TelegramMessage,
  student: Student,
  chatId: number,
  text: string | null,
  photo: { bytes: Uint8Array; mimeType: string } | null
): Promise<void> {
  await sendChatAction(chatId, "typing");

  switch (student.current_step) {
    case 1: await handleStep1(student, chatId, text, photo); break;
    case 2: await handleStep2(student, chatId, text, photo); break;
    case 3: await handleStep3(student, chatId, text, photo); break; // send normal template
    case 4: await handleStep4(student, chatId, text, photo); break;
    case 5: await handleStep5(student, chatId, text, photo); break;
    case 6: await handleStep6(student, chatId, text, photo); break;
    case 7: await handleStep7(student, chatId, text, photo); break; // send premium template
    case 8: await handleStep8(student, chatId, text, photo); break;
    case 9: await handleStep9(student, chatId, text, photo); break;
    default: await sendMessage(chatId, "Send me that screenshot when you're ready 📸");
  }
}

// Step 1: GitHub account creation
async function handleStep1(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const reply = await geminiChat(history, text, "Student is on Day 2 Step 1. They need to create a GitHub account at github.com/signup and send a screenshot. Answer any question and redirect them.", student.id);
      await sendMessage(chatId, reply);
    } else {
      await sendMessage(chatId, "Go to <a href=\"https://github.com/signup\">github.com/signup</a> and send me a screenshot when you're on the signup page 📸");
    }
    return;
  }

  const prompt = buildVerificationPrompt(
    "Does this screenshot show the GitHub website — either the signup/registration page, or a GitHub user profile/dashboard after signing in?",
    ["github_username"]
  );
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    const rawUsername = result.extracted?.github_username ?? "";
    await recordStepCompletion(student.id, 2, 1, true);

    // Ask for their desired username
    await typeMessage(
      chatId,
      `You're on GitHub! ✅\n\nNow — for your <b>username</b>, I recommend something like: <code>EEM26${student.full_name?.split(" ")[0] ?? "Student"}</code>\n\nThis makes your links look professional and branded.\n\nWhat first name do you want to use in your username? (Can be a short version)`
    );
    await advanceStep(student.id, 2, 2, rawUsername ? { github_username: rawUsername } : {});
  } else {
    await handleFailed(student, chatId, result.reason, result.guidance || "Go to <a href=\"https://github.com/signup\">github.com/signup</a>, create your account, then send me a screenshot 📸");
  }
}

// Step 2: GitHub username chosen + create EEM26page repo
async function handleStep2(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  // If they send their name/username choice as text
  if (text && !photo) {
    const firstName = text.trim().split(/\s+/)[0];
    const suggestedUsername = `EEM26${firstName}`;
    await updateStudent(student.id, { github_username: text.trim().replace(/\s+/g, "") });
    await typeMessage(chatId, `Perfect! Use the username: <code>${suggestedUsername}</code> 🎯`);
    await typeMessage(chatId, `Once your GitHub account is created with that username, let's create your first repository!\n\n1️⃣ Log into GitHub\n2️⃣ Click the <b>+</b> button top right\n3️⃣ Click <b>"New repository"</b>\n\nSend me a screenshot when you see the "Create new repository" page 📸`);
    await advanceStep(student.id, 2, 3, { github_username: suggestedUsername });
    return;
  }

  if (!photo) {
    await sendMessage(chatId, "What first name do you want in your GitHub username? Just send me the name (e.g. Chidi, Fatima, etc.) 😊");
    return;
  }

  // They might have sent a screenshot of their new GitHub account
  const prompt = buildVerificationPrompt("Does this screenshot show a GitHub profile page or GitHub account dashboard?", ["github_username"]);
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);
  if (result.verified) {
    await recordStepCompletion(student.id, 2, 2, true);
    const username = result.extracted?.github_username || student.github_username || "";
    await advanceStep(student.id, 2, 3, username ? { github_username: username } : {});
    await typeMessage(
      chatId,
      `Account confirmed! ✅\n\nNow create your first repo:\n1️⃣ Click the <b>+</b> button at the top right of GitHub\n2️⃣ Click <b>"New repository"</b>\n\nDrop a screenshot when you see the "Create new repository" page 📸`
    );
  } else {
    await handleFailed(student, chatId, result.reason, result.guidance || "What first name do you want to use in your GitHub username? Just type it for me.");
  }
}

// Step 3: New repo page screenshot → then auto-send the HTML file
async function handleStep3(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const reply = await geminiChat(history, text, "Student needs to click '+' → 'New repository' on GitHub and send a screenshot of the Create New Repository page.", student.id);
      await sendMessage(chatId, reply);
    } else {
      await sendMessage(chatId, "Click <b>+</b> → <b>New repository</b> on GitHub, then send me a screenshot of that page 📸");
    }
    return;
  }

  const prompt = buildVerificationPrompt("Does this screenshot show the GitHub 'Create a new repository' page? Look for repository name input field, public/private options, and README checkbox.");
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await typeMessage(chatId, `Perfect! 🎯 Now fill in the details EXACTLY like this:\n\n📝 <b>Repository name:</b> <code>EEM26page</code>\n📝 <b>Description:</b> My EEM26 Sales Page\n✅ Set to <b>PUBLIC</b>\n✅ Check <b>"Add a README file"</b>`);
    await typeMessage(chatId, `Then click <b>"Create repository"</b> and snap me a screenshot 📸`);
    await advanceStep(student.id, 2, 4);
  } else {
    await handleFailed(student, chatId, result.reason, result.guidance || "Click <b>+</b> at the top right of GitHub, then <b>\"New repository\"</b>, and send me a screenshot of that page 📸");
  }
}

// Step 4: Repo created screenshot → send customized HTML file
async function handleStep4(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const reply = await geminiChat(history, text, "Student needs to create the EEM26page repository on GitHub and send a screenshot.", student.id);
      await sendMessage(chatId, reply);
    } else {
      await sendMessage(chatId, "Create the <code>EEM26page</code> repository and send me a screenshot 📸");
    }
    return;
  }

  const prompt = buildVerificationPrompt("Does this screenshot show an empty GitHub repository named EEM26page (or a newly created repo) with the main branch?");
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await recordStepCompletion(student.id, 2, 4, true);
    // Save the repo URL
    const username = student.github_username ?? "student";
    const repoUrl = `https://${username}.github.io/EEM26page/`;
    await updateStudent(student.id, { github_repo_normal: repoUrl, sales_page_link: repoUrl });

    // Generate and send the customized HTML
    await sendChatAction(chatId, "upload_document");
    const template = await getNormalTemplate();
    const payhipLink = student.payhip_link ?? "https://payhip.com";
    const customized = modifyTemplateForStudent(template, payhipLink);
    const fileBytes = new TextEncoder().encode(customized);

    await sendDocument(
      chatId,
      "index.html",
      fileBytes,
      "Your personal sales page — customized with YOUR Payhip link! 🎉 This is from your Tech Stack 📦"
    );

    await new Promise((r) => setTimeout(r, 400));
    await typeMessage(chatId, `That file I just sent is YOUR personal sales page — your Payhip link is already inside it! 💪 From your Tech Stack 📦`);
    await typeMessage(chatId, `Now upload it to GitHub:\n1️⃣ In your repo click <b>"Add file"</b> → <b>"Upload files"</b>\n2️⃣ Drag the <b>index.html</b> file into the upload box\n3️⃣ Scroll down and click <b>"Commit changes"</b>`);
    await typeMessage(chatId, `Send me a screenshot when the file is uploaded 📸`);
    await advanceStep(student.id, 2, 5);
  } else {
    await handleFailed(student, chatId, result.reason, result.guidance || "Fill in the repo name as exactly <code>EEM26page</code>, make it Public, check the README box, then create it and screenshot 📸");
  }
}

// Step 5: File uploaded screenshot → enable GitHub Pages
async function handleStep5(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const reply = await geminiChat(history, text, "Student needs to upload the index.html file to their EEM26page GitHub repo.", student.id);
      await sendMessage(chatId, reply);
    } else {
      await sendMessage(chatId, "Add File → Upload Files → drag index.html → Commit changes — then send me a screenshot 📸");
    }
    return;
  }

  const prompt = buildVerificationPrompt("Does this screenshot show the GitHub EEM26page repository with an index.html file uploaded in it?");
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await recordStepCompletion(student.id, 2, 5, true);
    await typeMessage(chatId, `index.html is uploaded! 🔥 Now let's make it LIVE.`);
    await typeMessage(chatId, `1️⃣ Click <b>Settings</b> in your repo\n2️⃣ Scroll left menu to <b>"Pages"</b>\n3️⃣ Under Source → <b>"Deploy from a branch"</b>\n4️⃣ Branch → <b>"main"</b> → <b>Save</b>\n\nShow me a screenshot of the Pages settings 📸`);
    await advanceStep(student.id, 2, 6);
  } else {
    await handleFailed(student, chatId, result.reason, result.guidance || "Go to your EEM26page repo → Add file → Upload files → drag index.html → Commit changes, then screenshot 📸");
  }
}

// Step 6: GitHub Pages screenshot → extract live URL
async function handleStep6(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const reply = await geminiChat(history, text, "Student needs to enable GitHub Pages for the EEM26page repo under Settings → Pages → Branch: main → Save.", student.id);
      await sendMessage(chatId, reply);
    } else {
      await sendMessage(chatId, "Settings → Pages → Source: Deploy from branch → Branch: main → Save, then send me a screenshot 📸");
    }
    return;
  }

  const prompt = buildVerificationPrompt(
    "Does this screenshot show GitHub Pages settings with a branch selected (main) and a live URL shown?",
    ["sales_page_link"]
  );
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await recordStepCompletion(student.id, 2, 6, true);
    const extractedUrl = result.extracted?.sales_page_link;
    const username = student.github_username ?? "student";
    const salesUrl = extractedUrl || `https://${username}.github.io/EEM26page/`;
    await updateStudent(student.id, { sales_page_link: salesUrl, github_repo_normal: salesUrl });

    await typeMessage(chatId, `Your FIRST sales page is LIVE!! 🎉🔥\n\n🌐 <b>Your page:</b>\n<code>${salesUrl}</code>\n\nSave that link — it's yours! 💪`);
    await new Promise((r) => setTimeout(r, 300));
    await typeMessage(chatId, `Now let's build the <b>Premium</b> version too 💎\n\nCreate a second repo:\n1️⃣ Click <b>+</b> → <b>New repository</b>\n2️⃣ Name: <code>EEM26premium</code>\n3️⃣ Public ✅ + Add README ✅\n4️⃣ Click <b>Create repository</b>\n\nSend me a screenshot when it's created 📸`);
    await advanceStep(student.id, 2, 7);
  } else {
    await handleFailed(student, chatId, result.reason, result.guidance || "Go to Settings → Pages, set Branch to 'main', save, and screenshot the page 📸");
  }
}

// Step 7: Premium repo created → send premium HTML file
async function handleStep7(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const reply = await geminiChat(history, text, "Student needs to create the EEM26premium GitHub repo.", student.id);
      await sendMessage(chatId, reply);
    } else {
      await sendMessage(chatId, "Create the <code>EEM26premium</code> repository and send me a screenshot 📸");
    }
    return;
  }

  const prompt = buildVerificationPrompt("Does this screenshot show a newly created GitHub repository named EEM26premium?");
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await recordStepCompletion(student.id, 2, 7, true);
    const username = student.github_username ?? "student";
    const premiumUrl = `https://${username}.github.io/EEM26premium/`;
    await updateStudent(student.id, { github_repo_premium: premiumUrl });

    // Send premium template
    await sendChatAction(chatId, "upload_document");
    const template = await getPremiumTemplate();
    const payhipLink = student.payhip_link ?? "https://payhip.com";
    const customized = modifyTemplateForStudent(template, payhipLink);
    const fileBytes = new TextEncoder().encode(customized);

    await sendDocument(
      chatId,
      "index.html",
      fileBytes,
      "Your PREMIUM sales page — also customized for you! 💎 From your Tech Stack 📦"
    );

    await new Promise((r) => setTimeout(r, 400));
    await typeMessage(chatId, `Now upload this premium page the same way:\n1️⃣ In the EEM26premium repo → <b>Add file → Upload files</b>\n2️⃣ Drag the index.html I just sent\n3️⃣ Click <b>Commit changes</b>\n\nSnap me a screenshot when done 📸`);
    await advanceStep(student.id, 2, 8);
  } else {
    await handleFailed(student, chatId, result.reason, result.guidance || "Create a new repo named exactly <code>EEM26premium</code> → Public → Add README → Create, then screenshot 📸");
  }
}

// Step 8: Premium file uploaded screenshot
async function handleStep8(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const reply = await geminiChat(history, text, "Student needs to upload index.html to the EEM26premium repo.", student.id);
      await sendMessage(chatId, reply);
    } else {
      await sendMessage(chatId, "Upload the index.html to EEM26premium → Commit changes → send screenshot 📸");
    }
    return;
  }

  const prompt = buildVerificationPrompt("Does this screenshot show the GitHub EEM26premium repository with an index.html file in it?");
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await recordStepCompletion(student.id, 2, 8, true);
    await typeMessage(chatId, `Uploaded! 🔥 Now make the premium page live:\n\n1️⃣ Settings → <b>Pages</b>\n2️⃣ Source: <b>Deploy from branch</b>\n3️⃣ Branch: <b>main</b> → <b>Save</b>\n\nDrop me a screenshot of the Pages settings 📸`);
    await advanceStep(student.id, 2, 9);
  } else {
    await handleFailed(student, chatId, result.reason, result.guidance || "Go to the EEM26premium repo → Add file → Upload files → drag index.html → Commit changes, then screenshot 📸");
  }
}

// Step 9: Premium GitHub Pages screenshot → Day 2 complete
async function handleStep9(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const reply = await geminiChat(history, text, "Student needs to enable GitHub Pages for EEM26premium.", student.id);
      await sendMessage(chatId, reply);
    } else {
      await sendMessage(chatId, "Settings → Pages → Branch: main → Save, then send me a screenshot 📸");
    }
    return;
  }

  const prompt = buildVerificationPrompt("Does this screenshot show GitHub Pages settings with branch selected and a live URL?", ["premium_url"]);
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await recordStepCompletion(student.id, 2, 9, true);
    const username = student.github_username ?? "student";
    const premiumUrl = result.extracted?.premium_url || `https://${username}.github.io/EEM26premium/`;
    const normalUrl = student.sales_page_link || `https://${username}.github.io/EEM26page/`;
    await updateStudent(student.id, { github_repo_premium: premiumUrl });

    const nextUnlock = computeNextUnlockAt();
    await advanceStep(student.id, 2, 0, {
      day2_completed_at: new Date().toISOString(),
      next_day_unlocks_at: nextUnlock,
    });

    await typeMessage(chatId, `<b>INCREDIBLE!! 🔥 Day 2 DONE!!</b>\n\nYou now have TWO live sales pages:\n🌐 <b>Normal:</b> <code>${normalUrl}</code>\n💎 <b>Premium:</b> <code>${premiumUrl}</code>\n\nThese are YOUR links. Share them anywhere. Every click that converts = 💰`);
    await typeMessage(chatId, `Tomorrow we build your SRE — the Smart Reply Engine from your Tech Stack 📦 It's an AI bot that replies to customers and closes sales for you automatically, even while you sleep 😈\n\nRest well — <b>Day 3 unlocks at 8AM tomorrow!</b> 🌟`);

    await notifyAdmin(
      `✅ <b>DAY 2 COMPLETE</b>\n\nStudent: ${student.full_name}\nCountry: ${student.country}\nNormal page: ${normalUrl}\nPremium page: ${premiumUrl}`
    );
  } else {
    await handleFailed(student, chatId, result.reason, result.guidance || "Settings → Pages → Branch: main → Save in the EEM26premium repo, then screenshot 📸");
  }
}

async function handleFailed(student: Student, chatId: number, reason: string, retryMsg: string): Promise<void> {
  if (reason === "verification_unavailable") {
    await sendMessage(chatId, "Photo check had a small hiccup 😊 — please send that screenshot again!");
    return;
  }
  const attempts = student.screenshot_attempts + 1;
  if (attempts >= 3) {
    await resetScreenshotAttempts(student.id);
    await notifyAdmin(`⚠️ <b>STUDENT STUCK</b>\nName: ${student.full_name}\nDay: ${student.current_day}, Step: ${student.current_step}\nReason: ${reason}`);
  } else {
    await incrementScreenshotAttempts(student.id, student.screenshot_attempts);
  }
  const history = await getRecentConversation(student.id, 3);
  const reply = await geminiChat(
    history,
    `[screenshot analysis]`,
    `Student sent a screenshot that wasn't correct. Here is what the screenshot actually shows: "${reason}". Here is what they need to do: "${retryMsg}".
In Amara's warm, friendly style: tell the student EXACTLY what you can see in their screenshot (be specific about what page/screen it is), then give them PRECISE step-by-step instructions on what to click or do next to get to the right place. Don't be generic — be like a friend looking at their phone screen and guiding them.`,
    student.id
  );
  await sendMessage(chatId, reply);
}
