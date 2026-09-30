function buildPracticeEngineSurvey() {
  var form = FormApp.create('Practice Engine Beta — Wrap-up Survey');
  form.setDescription(
    "The Practice Engine beta wraps up Wednesday, Sept 30. This is the last thing I'll ask you. About 5 minutes.\n\n" +
    "Here's the most useful thing you can tell me: \"I didn't really use it.\" That's not a failed beta. That's the data.\n\n" +
    "Honest beats nice. Nice gets me a tool nobody opens.\n\nThank you for doing this. — Jason"
  );
  form.setCollectEmail(false);
  form.setAllowResponseEdits(true);
  form.setProgressBar(true);
  form.setConfirmationMessage("Got it. Thank you — really. I read every one of these myself. — Jason");

  // ---------- Page 1: Did you use it at all? ----------
  form.addTextItem().setTitle('Your name').setHelpText('Probably already filled in for you.').setRequired(true);

  var q1 = form.addMultipleChoiceItem().setTitle('When did you last open the Practice Engine?').setRequired(true);
  form.addParagraphTextItem()
    .setTitle("If you barely used it (or never did) — what got in the way?")
    .setHelpText("No wrong answers. This is honestly the most useful question on the page.");

  // ---------- Page 2: What did you do ----------
  var p2 = form.addPageBreakItem().setTitle('What did you actually do with it?');
  form.addTextItem().setTitle('Which tune did you use it on most?');
  form.addCheckboxItem().setTitle('What did you actually do? (check all that apply)')
    .setChoiceValues(['Slowed the tempo down', 'Sped it up', 'Looped a section', 'Used the A or B buttons',
      'Hid the sheet music', 'Just pressed play and played along'])
    .showOtherOption(true);
  form.addMultipleChoiceItem().setTitle('Roughly how long was a typical session with it?')
    .setChoiceValues(['Under 5 minutes', '5–15 minutes', '15–30 minutes', '30+ minutes']);
  form.addMultipleChoiceItem().setTitle('Did you come back to it on a different day?')
    .setChoiceValues(['Yes, several times', 'Once or twice', 'No']);

  // ---------- Page 3: The two that matter ----------
  form.addPageBreakItem().setTitle('Two quick ones that help me most');
  form.addMultipleChoiceItem().setTitle('What did you mostly use it INSTEAD of?')
    .setChoiceValues(['One of my (Jason\'s) play-along tracks', 'A metronome', 'A YouTube video slowed down',
      'Sheet music alone', "Nothing — it was extra practice I wouldn't have done"])
    .showOtherOption(true);
  form.addMultipleChoiceItem().setTitle('If I removed it tomorrow, how would you feel?')
    .setChoiceValues(['Very disappointed', 'Somewhat disappointed', "Wouldn't much matter"]).setRequired(true);
  form.addParagraphTextItem().setTitle('Was there a time you thought about using it and didn\'t? What happened?');

  // ---------- Page 4: Engine vs. tracks ----------
  var p4 = form.addPageBreakItem().setTitle('The Practice Engine and my play-along tracks')
    .setHelpText("Not a contest. They do different jobs. I just want to know when you reach for which.");
  form.addMultipleChoiceItem().setTitle('When you want to practice a tune, which do you reach for first?')
    .setChoiceValues(['The Practice Engine', 'One of my play-along tracks', 'Depends (tell me below)']);
  form.addParagraphTextItem().setTitle('If it depends — what makes you pick one over the other?');
  form.addParagraphTextItem().setTitle("Is there anything the play-along tracks give you that the Practice Engine doesn't?");

  // ---------- Page 5: Open + call ----------
  form.addPageBreakItem().setTitle('Last bit');
  form.addParagraphTextItem().setTitle('Anything else? Confusing, broken, missing, annoying — all fair game.');
  form.addMultipleChoiceItem()
    .setTitle('Would you be up for a 20-minute chat with me sometime Oct 1–7?')
    .setHelpText('Zoom or phone, your pick. Totally optional.')
    .setChoiceValues(["Sure, email me", 'Not this time']);

  // Skip logic: "Never opened it" jumps straight to page 4
  q1.setChoices([
    q1.createChoice('This week', FormApp.PageNavigationType.CONTINUE),
    q1.createChoice('Last week', FormApp.PageNavigationType.CONTINUE),
    q1.createChoice('Longer ago', FormApp.PageNavigationType.CONTINUE),
    q1.createChoice('Never opened it', p4)
  ]);

  var ss = SpreadsheetApp.create('Practice Engine Beta — Wrap-up Survey (Responses)');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  var nameItem = form.getItems(FormApp.ItemType.TEXT)[0].asTextItem();
  var prefill = form.createResponse().withItemResponse(nameItem.createResponse('XXNAMEXX')).toPrefilledUrl();

  console.log('PUBLISHED=' + form.getPublishedUrl());
  console.log('EDIT=' + form.getEditUrl());
  console.log('SHEET=' + ss.getUrl());
  console.log('PREFILL=' + prefill);
}
