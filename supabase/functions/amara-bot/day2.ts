import { sendMessage, sendChatAction, sendDocument, typeMessage } from "./telegram.ts";
import { advanceStep, updateStudent, incrementScreenshotAttempts, resetScreenshotAttempts, recordStepCompletion, computeNextUnlockAt, getRecentConversation } from "./db.ts";
import { geminiVision, geminiChat, geminiVisionGuide, buildVerificationPrompt } from "./gemini.ts";
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

    await typeMessage(
      chatId,
      `You're on GitHub! ✅\n\nNow — for your <b>username</b>, I recommend something like: <code>EEM26${student.full_name?.split(" ")[0] ?? "Student"}</code>\n\nThis makes your links look professional and branded.\n\nWhat first name do you want to use in your username? (Can be a short version)`
    );
    await advanceStep(student.id, 2, 2, rawUsername ? { github_username: rawUsername } : {});
  } else {
    await handleFailed(student, chatId, result.reason, result.guidance || "Go to <a href=\"https://github.com/signup\">github.com/signup</a>, create your account, then send me a screenshot 📸",
      photo, "Student needs to be on the GitHub website — either the signup page at github.com/signup or their GitHub profile/dashboard after logging in. Guide them based on what you can see.");
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
    await handleFailed(student, chatId, result.reason, result.guidance || "What first name do you want to use in your GitHub username? Just type it for me.",
      photo, "Student needs to show their GitHub profile or account dashboard. Guide them based on what you see on screen.");
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

  const prompt = buildVerificationPrompt(
    "Does this screenshot show a GitHub page related to creating a repository? Accept ANY of these as verified=true:\n" +
    "1. The 'Create a new repository' FORM — has input fields for repo name, public/private radio buttons, README checkbox\n" +
    "2. GitHub 'Quick setup' page — shows 'Quick setup — if you've done this kind of thing before', HTTPS/SSH tabs, a clone URL, and git command blocks (echo, git init, git push, etc.). THIS MEANS THE REPO IS ALREADY CREATED.\n" +
    "3. A GitHub repository dashboard showing the repo files or empty repo state\n" +
    "4. A GitHub file editor or 'Create new file' page (the student clicked the wrong button)\n" +
    "Reject only if it's a completely unrelated website with no GitHub content.",
    [
      "page_type: write 'form' if creation form, 'quick_setup' if git setup commands page, 'repo' if repo dashboard, 'file_editor' if showing a code/file editor",
      "repo_name: the repository name visible in the page URL or heading (e.g. 'EEM26page', 'EEM-26-setup-', etc.)"
    ]
  );
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    const pageType = result.extracted?.page_type ?? "";
    const repoName = result.extracted?.repo_name ?? "";
    const isFileEditor = /file.?editor/i.test(pageType) || /create.{0,5}new.{0,5}file|new file.*editor/i.test(result.reason ?? "");
    const repoAlreadyCreated =
      !isFileEditor && (
        /quick.?setup|repo/i.test(pageType) ||
        /quick setup|git init|git remote|push.*origin|clone.*url/i.test(result.reason ?? "")
      );

    if (isFileEditor) {
      // Student clicked "Create new file" — redirect them to upload instead
      await typeMessage(chatId, `Hold on! 🛑 You clicked <b>"Create new file"</b> — that's for typing code from scratch.`);
      await typeMessage(chatId, `Click <b>"Cancel"</b> to go back to your repo, then:\n1️⃣ Click <b>"Add file"</b>\n2️⃣ Select <b>"Upload files"</b>\n3️⃣ Upload the <b>index.html</b> I sent you 📁`);
      return;
    }

    if (repoAlreadyCreated) {
      // Repo is already created — check name and proceed
      await recordStepCompletion(student.id, 2, 3, true, `Repo already created (Quick Setup). Name: ${repoName}`);
      const nameIsWrong = repoName && !/^EEM26page$/i.test(repoName.replace(/[-_\s]/g, ""));
      if (nameIsWrong) {
        await typeMessage(chatId, `I can see your repo "${repoName}" was created! 🎉 No wahala — the name is a little different from what we need, but we can work with it.`);
      } else {
        await typeMessage(chatId, `Your EEM26page repo is created! 🎉 Oya let's go!`);
      }
      await new Promise((r) => setTimeout(r, 300));
      await sendNormalHtmlFile(student, chatId);
    } else {
      // Still on the creation form — guide them to fill it in
      await typeMessage(chatId, `Perfect! 🎯 Now fill in the details EXACTLY like this:\n\n📝 <b>Repository name:</b> <code>EEM26page</code>\n📝 <b>Description:</b> My EEM26 Sales Page\n✅ Set to <b>PUBLIC</b>\n✅ Check <b>"Add a README file"</b>`);
      await typeMessage(chatId, `Then click <b>"Create repository"</b> and snap me a screenshot 📸`);
      await advanceStep(student.id, 2, 4);
    }
  } else {
    await handleFailed(
      student, chatId, result.reason,
      result.guidance || "Click <b>+</b> at the top right of GitHub, then <b>\"New repository\"</b>, and send me a screenshot of that page 📸",
      photo,
      "Student is on Day 2 creating the EEM26page GitHub repository on github.com. " +
      "IF you see a 'Quick setup' page (HTTPS/SSH options, git init/push commands): repo IS created — tell them the repo is ready. " +
      "IF you see a file editor or 'Create new file' page: they clicked the WRONG button — tell them to click Cancel, then use Add file → Upload files. " +
      "IF you see the creation form: guide them to fill in name=EEM26page, Public, README checkbox. " +
      "NEVER tell them to click 'Create new file' — they need to UPLOAD a file, not create one."
    );
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

  const prompt = buildVerificationPrompt(
    "Does this screenshot show a GitHub repository page? Accept any of these as verified=true:\n" +
    "- GitHub 'Quick setup' page with HTTPS/SSH clone URL and git command blocks (echo, git init, git push)\n" +
    "- An empty GitHub repository dashboard with main branch\n" +
    "- A GitHub repository showing files or README\n" +
    "Reject if: still on the 'Create new repository' form (input fields not submitted), a GitHub file editor, or a completely different website."
  );
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await recordStepCompletion(student.id, 2, 4, true);
    await sendNormalHtmlFile(student, chatId);
  } else {
    await handleFailed(
      student, chatId, result.reason,
      result.guidance || "Fill in the repo name as exactly <code>EEM26page</code>, make it Public, check the README box, then create it and screenshot 📸",
      photo,
      "Student needs to show their EEM26page GitHub repository after it's been created. " +
      "IF they show the Quick Setup page (git commands, HTTPS/SSH): repo IS created — move them forward. " +
      "IF they show a file editor or 'Create new file' page: tell them to click Cancel, then use Add file → Upload files. " +
      "IF they're still on the creation form: guide them to fill it in with name=EEM26page, Public, README. " +
      "NEVER tell them to click 'Create new file' — they need to upload the index.html file sent by the bot."
    );
  }
}

// Shared helper: generate + send the customized normal HTML template and advance to Step 5
async function sendNormalHtmlFile(student: Student, chatId: number): Promise<void> {
  const username = student.github_username ?? "student";
  const repoUrl = `https://${username}.github.io/EEM26page/`;
  await updateStudent(student.id, { github_repo_normal: repoUrl, sales_page_link: repoUrl });

  await sendChatAction(chatId, "upload_document");
  const template = await getNormalTemplate();
  const payhipLink = student.payhip_link ?? "https://payhip.com";
  const customized = modifyTemplateForStudent(template, payhipLink);
  const fileBytes = new TextEncoder().encode(customized);

  await sendDocument(chatId, "index.html", fileBytes, "Your personal sales page — customized with YOUR Payhip link! 🎉 From your Tech Stack 📦");

  await new Promise((r) => setTimeout(r, 400));
  await typeMessage(chatId, `That file I just sent is YOUR personal sales page — your Payhip link is already inside it! 💪 From your Tech Stack 📦`);
  await typeMessage(chatId, `Now upload it to GitHub:\n1️⃣ In your repo click <b>"Add file"</b> → <b>"Upload files"</b>\n2️⃣ Drag the <b>index.html</b> file into the upload box\n3️⃣ Scroll down and click <b>"Commit changes"</b>`);
  await typeMessage(chatId, `Send me a screenshot when the file is uploaded 📸`);
  await advanceStep(student.id, 2, 5);
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

  const prompt = buildVerificationPrompt(
    "Does this screenshot show a GitHub repository with an index.html file successfully uploaded? " +
    "Also accept the file UPLOAD interface (drag-and-drop zone showing index.html ready to commit). " +
    "Reject if showing: a file editor/code editor, the repo with NO index.html, or an unrelated page."
  );
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await recordStepCompletion(student.id, 2, 5, true);
    await typeMessage(chatId, `index.html is uploaded! 🔥 Now let's make it LIVE.`);
    await typeMessage(chatId, `1️⃣ Click <b>Settings</b> in your repo\n2️⃣ Scroll left menu to <b>"Pages"</b>\n3️⃣ Under Source → <b>"Deploy from a branch"</b>\n4️⃣ Branch → <b>"main"</b> → <b>Save</b>\n\nShow me a screenshot of the Pages settings 📸`);
    await advanceStep(student.id, 2, 6);
  } else {
    await handleFailed(student, chatId, result.reason,
      result.guidance || "Go to your repo → Add file → Upload files → drag index.html → Commit changes 📸",
      photo,
      "Student needs to upload the index.html file to their GitHub repository. " +
      "IF you see a file editor or 'Create new file' code editor: they clicked wrong — tell them to click Cancel, go back to the repo, then click Add file → Upload files (NOT Create new file). " +
      "IF you see the repo with no files (Quick Setup or empty): tell them to click Add file → Upload files, drag the index.html I sent them, then scroll down and click Commit changes. " +
      "IF you see the upload drag-drop zone: they're in the right place — tell them to drag the index.html file into the box. " +
      "NEVER suggest 'Create new file' — they must UPLOAD the pre-made HTML file."
    );
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
    await handleFailed(student, chatId, result.reason, result.guidance || "Go to Settings → Pages, set Branch to 'main', save, and screenshot the page 📸",
      photo, "Student needs to enable GitHub Pages for their EEM26page repo: Settings → Pages → Source: Deploy from branch → Branch: main → Save. Guide them based on what you can see on screen.");
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

  const prompt = buildVerificationPrompt(
    "Does this screenshot show a GitHub repository that was just created? Accept: Quick Setup page (git commands, HTTPS/SSH), empty repo dashboard, or a repo dashboard. " +
    "Reject if: 'Create new repository' form still open, or file editor/code editor, or unrelated website.",
    ["repo_name: the repository name shown in the URL or page heading"]
  );
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

    await sendDocument(chatId, "index.html", fileBytes, "Your PREMIUM sales page — also customized for you! 💎 From your Tech Stack 📦");

    await new Promise((r) => setTimeout(r, 400));
    await typeMessage(chatId, `Now upload this premium page the same way:\n1️⃣ In the EEM26premium repo → <b>Add file → Upload files</b>\n2️⃣ Drag the index.html I just sent\n3️⃣ Click <b>Commit changes</b>\n\nSnap me a screenshot when done 📸`);
    await advanceStep(student.id, 2, 8);
  } else {
    await handleFailed(student, chatId, result.reason,
      result.guidance || "Create a new repo named exactly <code>EEM26premium</code> → Public → Add README → Create, then screenshot 📸",
      photo,
      "Student needs to create the EEM26premium GitHub repository and show the result. " +
      "IF they show a file editor ('Create new file'): tell them they clicked the wrong button — click Cancel and go back to the repo. " +
      "IF they show the Quick Setup page: repo is created, move forward. " +
      "IF they show a different repo name: note it but proceed. Guide based on what you see."
    );
  }
}

// Step 8: Premium file uploaded screenshot
async function handleStep8(student: Student, chatId: number, text: string | null, photo: { bytes: Uint8Array; mimeType: string } | null): Promise<void> {
  if (!photo) {
    if (text) {
      const history = await getRecentConversation(student.id, 6);
      const reply = await geminiChat(history, text, "Student needs to upload index.html to the EEM26premium repo using Add file → Upload files → Commit changes. Make sure they use Upload files, NOT Create new file.", student.id);
      await sendMessage(chatId, reply);
    } else {
      await sendMessage(chatId, "In EEM26premium → <b>Add file</b> → <b>Upload files</b> → drag index.html → Commit changes → send screenshot 📸");
    }
    return;
  }

  const prompt = buildVerificationPrompt("Does this screenshot show the GitHub EEM26premium repository with an index.html file in it? Also accept the upload drag-drop zone with index.html ready to commit.");
  const result = await geminiVision(photo.bytes, photo.mimeType, prompt);

  if (result.verified) {
    await recordStepCompletion(student.id, 2, 8, true);
    await typeMessage(chatId, `Uploaded! 🔥 Now make the premium page live:\n\n1️⃣ Settings → <b>Pages</b>\n2️⃣ Source: <b>Deploy from branch</b>\n3️⃣ Branch: <b>main</b> → <b>Save</b>\n\nDrop me a screenshot of the Pages settings 📸`);
    await advanceStep(student.id, 2, 9);
  } else {
    await handleFailed(student, chatId, result.reason,
      result.guidance || "Go to EEM26premium repo → Add file → Upload files → drag index.html → Commit changes 📸",
      photo,
      "Student needs to upload the index.html file to their EEM26premium GitHub repo. " +
      "IF they show a code/file editor ('Create new file'): they clicked WRONG — tell them Cancel, then Add file → Upload files. " +
      "IF they show the repo with no files: tell them Add file → Upload files, drag index.html, click Commit changes. " +
      "NEVER suggest creating a new file — they must upload the file the bot sent them."
    );
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
    await handleFailed(student, chatId, result.reason, result.guidance || "Settings → Pages → Branch: main → Save in the EEM26premium repo, then screenshot 📸",
      photo, "Student needs to enable GitHub Pages for their EEM26premium repo: Settings → Pages → Source: Deploy from branch → Branch: main → Save. Guide them based on what you can see on screen.");
  }
}

async function handleFailed(
  student: Student,
  chatId: number,
  reason: string,
  retryMsg: string,
  photo?: { bytes: Uint8Array; mimeType: string } | null,
  stepContext?: string
): Promise<void> {
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

  if (photo && stepContext) {
    // Look at the ACTUAL screenshot — like a friend watching the student's screen
    const guidance = await geminiVisionGuide(photo.bytes, photo.mimeType, stepContext);
    await sendMessage(chatId, guidance);
  } else {
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
}
