import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib";
import type { Student } from "./types.ts";

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}


export async function generateCertificate(
  student: Student,
  signatureBytes: Uint8Array,
  signatureMimeType: string
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();

  // A4 Landscape: 842 x 595 pt
  const page = pdfDoc.addPage([842, 595]);
  const { width, height } = page.getSize();

  // Fonts
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  const fontTimes = await pdfDoc.embedFont(StandardFonts.TimesRoman);

  // Colors
  const cream = rgb(0.98, 0.96, 0.90);
  const gold = rgb(0.722, 0.529, 0.039);
  const navy = rgb(0.082, 0.098, 0.322);
  const darkGray = rgb(0.2, 0.2, 0.2);
  const midGray = rgb(0.4, 0.4, 0.4);
  const lightGold = rgb(0.9, 0.78, 0.3);

  // Background fill
  page.drawRectangle({ x: 0, y: 0, width, height, color: cream });

  // Outer decorative border (double line effect)
  page.drawRectangle({ x: 14, y: 14, width: width - 28, height: height - 28, borderColor: gold, borderWidth: 2 });
  page.drawRectangle({ x: 20, y: 20, width: width - 40, height: height - 40, borderColor: lightGold, borderWidth: 0.8 });

  // Corner ornaments (small rectangles at corners)
  const ornSize = 18;
  const ornPad = 14;
  const corners = [
    { x: ornPad, y: height - ornPad - ornSize },
    { x: width - ornPad - ornSize, y: height - ornPad - ornSize },
    { x: ornPad, y: ornPad },
    { x: width - ornPad - ornSize, y: ornPad },
  ];
  for (const c of corners) {
    page.drawRectangle({ x: c.x, y: c.y, width: ornSize, height: ornSize, borderColor: gold, borderWidth: 2 });
  }

  // Organization name (top center)
  const orgName = "SD DIGITAL ACADEMY";
  const orgW = fontBold.widthOfTextAtSize(orgName, 11);
  page.drawText(orgName, {
    x: (width - orgW) / 2,
    y: height - 52,
    font: fontBold,
    size: 11,
    color: gold,
  });

  const tagline = "LEARN & EARN";
  const tagW = fontRegular.widthOfTextAtSize(tagline, 7.5);
  page.drawText(tagline, {
    x: (width - tagW) / 2,
    y: height - 63,
    font: fontRegular,
    size: 7.5,
    color: midGray,
  });

  // Decorative horizontal divider below header
  page.drawLine({
    start: { x: 40, y: height - 74 },
    end: { x: width - 40, y: height - 74 },
    thickness: 0.8,
    color: gold,
  });

  // CERTIFICATE OF COMPLETION (main title)
  const title = "CERTIFICATE OF COMPLETION";
  const titleSize = 28;
  const titleW = fontBold.widthOfTextAtSize(title, titleSize);
  page.drawText(title, {
    x: (width - titleW) / 2,
    y: height - 118,
    font: fontBold,
    size: titleSize,
    color: navy,
  });

  // Program subtitle
  const subtitle = "EEM26 Tech Stack Setup Program";
  const subtitleW = fontItalic.widthOfTextAtSize(subtitle, 14);
  page.drawText(subtitle, {
    x: (width - subtitleW) / 2,
    y: height - 140,
    font: fontItalic,
    size: 14,
    color: gold,
  });

  // Thin divider
  page.drawLine({
    start: { x: width / 2 - 120, y: height - 152 },
    end: { x: width / 2 + 120, y: height - 152 },
    thickness: 0.5,
    color: midGray,
  });

  // "This is to certify that"
  const certifyText = "This is to certify that";
  const certifyW = fontItalic.widthOfTextAtSize(certifyText, 13);
  page.drawText(certifyText, {
    x: (width - certifyW) / 2,
    y: height - 178,
    font: fontItalic,
    size: 13,
    color: darkGray,
  });

  // Student name (large, prominent)
  const name = student.full_name ?? "Student";
  const nameSize = 34;
  const nameW = fontBold.widthOfTextAtSize(name, nameSize);
  const nameX = (width - nameW) / 2;
  const nameY = height - 218;
  page.drawText(name, {
    x: nameX,
    y: nameY,
    font: fontBold,
    size: nameSize,
    color: navy,
  });

  // Underline for name
  page.drawLine({
    start: { x: nameX - 8, y: nameY - 4 },
    end: { x: nameX + nameW + 8, y: nameY - 4 },
    thickness: 1.2,
    color: navy,
  });

  // Completion statement
  const statement = "has successfully completed the 4-Day EEM26 Business Setup Program";
  const statW = fontRegular.widthOfTextAtSize(statement, 11.5);
  page.drawText(statement, {
    x: (width - statW) / 2,
    y: height - 248,
    font: fontRegular,
    size: 11.5,
    color: darkGray,
  });

  const statement2 = "and has demonstrated practical knowledge of digital business systems, sales automation, and online entrepreneurship.";
  const stat2W = fontRegular.widthOfTextAtSize(statement2, 10.5);
  page.drawText(statement2, {
    x: (width - stat2W) / 2,
    y: height - 264,
    font: fontRegular,
    size: 10.5,
    color: darkGray,
  });

  // Certificate number and date
  const certNum = `EEM26-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const completionDate = new Date().toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  page.drawText(`Certificate No: ${certNum}`, {
    x: 44,
    y: height - 300,
    font: fontRegular,
    size: 8.5,
    color: midGray,
  });

  page.drawText(`Date of Completion: ${completionDate}`, {
    x: 44,
    y: height - 313,
    font: fontRegular,
    size: 8.5,
    color: midGray,
  });

  // Second divider above signatures
  page.drawLine({
    start: { x: 40, y: height - 328 },
    end: { x: width - 40, y: height - 328 },
    thickness: 0.5,
    color: gold,
  });

  // === SIGNATURES SECTION ===
  const sigY = height - 400;

  // LEFT: Coach Victor signature section
  const victorSigLabel = "Coach Victor";
  page.drawText(victorSigLabel, {
    x: 60,
    y: sigY + 40,
    font: fontBold,
    size: 13,
    color: navy,
  });

  // Signature line for Victor (decorative script-style text)
  page.drawText("Victor Nwaji", {
    x: 60,
    y: sigY + 18,
    font: fontItalic,
    size: 16,
    color: navy,
  });

  page.drawLine({
    start: { x: 56, y: sigY + 4 },
    end: { x: 240, y: sigY + 4 },
    thickness: 0.8,
    color: navy,
  });

  page.drawText("EEM26 Founder — Lead Coach", {
    x: 60,
    y: sigY - 10,
    font: fontRegular,
    size: 9,
    color: midGray,
  });

  page.drawText("Ecosystem Expansion Model (EEM26)", {
    x: 60,
    y: sigY - 22,
    font: fontRegular,
    size: 8,
    color: midGray,
  });

  // CENTER: SD Academy seal text
  const sealText = "SD DIGITAL ACADEMY";
  const sealW = fontBold.widthOfTextAtSize(sealText, 9);
  page.drawText(sealText, {
    x: (width - sealW) / 2,
    y: sigY + 22,
    font: fontBold,
    size: 9,
    color: gold,
  });
  const sealSub = "CERTIFIED";
  const sealSubW = fontRegular.widthOfTextAtSize(sealSub, 8);
  page.drawText(sealSub, {
    x: (width - sealSubW) / 2,
    y: sigY + 10,
    font: fontRegular,
    size: 8,
    color: gold,
  });
  // Draw circle for seal
  page.drawEllipse({
    x: width / 2,
    y: sigY + 16,
    xScale: 52,
    yScale: 30,
    borderColor: gold,
    borderWidth: 1.5,
  });

  // RIGHT: Student signature
  const rightX = width - 240;

  // Embed student signature photo
  try {
    const isJpeg = signatureMimeType.includes("jpeg") || signatureMimeType.includes("jpg");
    const sigImage = isJpeg
      ? await pdfDoc.embedJpg(signatureBytes)
      : await pdfDoc.embedPng(signatureBytes);
    const sigDims = sigImage.scaleToFit(140, 60);
    page.drawImage(sigImage, {
      x: rightX,
      y: sigY + 8,
      width: sigDims.width,
      height: sigDims.height,
    });
  } catch (e) {
    console.error("Signature embed error:", e);
    // Draw placeholder line instead
    page.drawLine({
      start: { x: rightX, y: sigY + 20 },
      end: { x: rightX + 180, y: sigY + 20 },
      thickness: 0.8,
      color: navy,
    });
  }

  page.drawLine({
    start: { x: rightX, y: sigY + 4 },
    end: { x: rightX + 180, y: sigY + 4 },
    thickness: 0.8,
    color: navy,
  });

  page.drawText(student.full_name ?? "Student", {
    x: rightX,
    y: sigY - 10,
    font: fontBold,
    size: 10,
    color: navy,
  });

  page.drawText("Student Signature", {
    x: rightX,
    y: sigY - 24,
    font: fontRegular,
    size: 8.5,
    color: midGray,
  });

  page.drawText("Hereby confirms receipt of full value from this program", {
    x: rightX,
    y: sigY - 36,
    font: fontRegular,
    size: 7.5,
    color: midGray,
  });

  // Footer
  page.drawLine({
    start: { x: 40, y: 38 },
    end: { x: width - 40, y: 38 },
    thickness: 0.5,
    color: gold,
  });

  const footer = "This certificate is issued by SD Digital Academy · EEM26 Tech Stack Program · ecosystemexpantion.github.io";
  const footerW = fontRegular.widthOfTextAtSize(footer, 7);
  page.drawText(footer, {
    x: (width - footerW) / 2,
    y: 26,
    font: fontRegular,
    size: 7,
    color: midGray,
  });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}
