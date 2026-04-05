// ═══════════════════════════════════════════
// ReplyPals — Template Library
// ═══════════════════════════════════════════

const TEMPLATES = [
    // ─── Work Emails ───
    {
        id: 'leave-request',
        name: 'Leave Request',
        category: 'Work Emails',
        icon: '📅',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'dates', label: 'Leave dates', placeholder: '7th and 26th March' },
            { id: 'reason', label: 'Reason', placeholder: 'personal reason' },
            { id: 'manager', label: "Manager's name", placeholder: 'optional', optional: true }
        ],
        prompt: (fields) => `Write a professional leave request email.
My name is ${fields.name}.
I need leave on ${fields.dates}.
Reason: ${fields.reason}.
${fields.manager ? "Manager's name: " + fields.manager : ''}
Keep it concise, respectful, and professional.`
    },
    {
        id: 'meeting-request',
        name: 'Meeting Request',
        category: 'Work Emails',
        icon: '📆',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'recipient', label: 'Recipient name/team', placeholder: 'Marketing team' },
            { id: 'topic', label: 'Meeting topic', placeholder: 'Q2 campaign review' },
            { id: 'time', label: 'Preferred time', placeholder: 'Tuesday 3pm', optional: true }
        ],
        prompt: (fields) => `Write a meeting request email.
From: ${fields.name}
To: ${fields.recipient}
Topic: ${fields.topic}
${fields.time ? 'Preferred time: ' + fields.time : 'Ask for their preferred time.'}
Keep it professional and concise.`
    },
    {
        id: 'project-update',
        name: 'Project Update to Manager',
        category: 'Work Emails',
        icon: '📊',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'project', label: 'Project name', placeholder: 'Website Redesign' },
            { id: 'update', label: 'Key update', placeholder: 'Completed design phase, moving to development' },
            { id: 'blockers', label: 'Any blockers?', placeholder: 'Waiting on brand assets', optional: true }
        ],
        prompt: (fields) => `Write a project status update email to my manager.
From: ${fields.name}
Project: ${fields.project}
Update: ${fields.update}
${fields.blockers ? 'Blockers: ' + fields.blockers : 'No blockers.'}
Keep it structured and concise with bullet points.`
    },
    {
        id: 'deadline-extension',
        name: 'Asking for Deadline Extension',
        category: 'Work Emails',
        icon: '⏰',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'task', label: 'Task/project', placeholder: 'Quarterly report' },
            { id: 'reason', label: 'Reason for extension', placeholder: 'Need more time for data analysis' },
            { id: 'new_deadline', label: 'Proposed new deadline', placeholder: 'Friday next week' }
        ],
        prompt: (fields) => `Write a professional email requesting a deadline extension.
From: ${fields.name}
Task: ${fields.task}
Reason: ${fields.reason}
Proposed new deadline: ${fields.new_deadline}
Be respectful and show accountability. Explain what has been done so far.`
    },
    {
        id: 'salary-discussion',
        name: 'Salary Discussion Opener',
        category: 'Work Emails',
        icon: '💰',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'role', label: 'Your role', placeholder: 'Senior Developer' },
            { id: 'tenure', label: 'Time at company', placeholder: '2 years' },
            { id: 'reason', label: 'Key reason', placeholder: 'Took on additional responsibilities' }
        ],
        prompt: (fields) => `Write a professional email opening a salary discussion with my manager.
From: ${fields.name}
Role: ${fields.role}
Time at company: ${fields.tenure}
Reason: ${fields.reason}
Be confident but diplomatic. Request a meeting to discuss compensation.`
    },
    {
        id: 'resignation-letter',
        name: 'Resignation Letter',
        category: 'Work Emails',
        icon: '📝',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'role', label: 'Your position', placeholder: 'Software Engineer' },
            { id: 'last_day', label: 'Last working day', placeholder: 'March 31, 2026' },
            { id: 'manager', label: "Manager's name", placeholder: 'Sarah', optional: true }
        ],
        prompt: (fields) => `Write a professional and graceful resignation letter.
From: ${fields.name}
Position: ${fields.role}
Last working day: ${fields.last_day}
${fields.manager ? "Manager: " + fields.manager : ''}
Express gratitude, offer to help with transition. Keep it professional and positive.`
    },
    {
        id: 'wfh-request',
        name: 'Work From Home Request',
        category: 'Work Emails',
        icon: '🏠',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'dates', label: 'WFH dates', placeholder: 'Monday and Tuesday next week' },
            { id: 'reason', label: 'Reason', placeholder: 'Internet installation at new apartment' }
        ],
        prompt: (fields) => `Write a professional work from home request email.
From: ${fields.name}
Dates: ${fields.dates}
Reason: ${fields.reason}
Assure work continuity and availability. Keep it concise.`
    },

    // ─── Client Communication ───
    {
        id: 'payment-followup',
        name: 'Following Up on Payment',
        category: 'Client Communication',
        icon: '💵',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'client', label: 'Client name', placeholder: 'John at Acme Corp' },
            { id: 'invoice', label: 'Invoice details', placeholder: 'Invoice #1023, due March 1st' },
            { id: 'amount', label: 'Amount', placeholder: '$2,500', optional: true }
        ],
        prompt: (fields) => `Write a polite but firm payment follow-up email.
From: ${fields.name}
To: ${fields.client}
Invoice: ${fields.invoice}
${fields.amount ? 'Amount: ' + fields.amount : ''}
Be professional. Remind them of the overdue payment without being aggressive.`
    },
    {
        id: 'apology-delay',
        name: 'Apologizing for Delay',
        category: 'Client Communication',
        icon: '🙇',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'client', label: 'Client/recipient', placeholder: 'Sarah' },
            { id: 'what', label: 'What was delayed', placeholder: 'Project deliverables' },
            { id: 'new_timeline', label: 'New timeline', placeholder: 'End of this week' }
        ],
        prompt: (fields) => `Write a professional apology email for a delay.
From: ${fields.name}
To: ${fields.client}
Delayed: ${fields.what}
New timeline: ${fields.new_timeline}
Take responsibility, explain briefly, and provide the new timeline with confidence.`
    },
    {
        id: 'share-proposal',
        name: 'Sharing a Proposal',
        category: 'Client Communication',
        icon: '📑',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'client', label: 'Client name', placeholder: 'Mark' },
            { id: 'project', label: 'Project/service', placeholder: 'Website redesign proposal' },
            { id: 'highlights', label: 'Key highlights', placeholder: 'Modern design, 6-week timeline, within budget' }
        ],
        prompt: (fields) => `Write a professional email to share a proposal with a client.
From: ${fields.name}
To: ${fields.client}
Proposal for: ${fields.project}
Key highlights: ${fields.highlights}
Be enthusiastic but professional. Invite them to discuss further.`
    },
    {
        id: 'decline-request',
        name: 'Declining a Request Politely',
        category: 'Client Communication',
        icon: '🚫',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'recipient', label: 'Recipient', placeholder: 'Sarah' },
            { id: 'request', label: 'What are you declining', placeholder: 'Additional scope without timeline extension' },
            { id: 'alternative', label: 'Alternative suggestion', placeholder: 'We can include this in Phase 2', optional: true }
        ],
        prompt: (fields) => `Write a polite email declining a request.
From: ${fields.name}
To: ${fields.recipient}
Declining: ${fields.request}
${fields.alternative ? 'Alternative: ' + fields.alternative : ''}
Be respectful, explain the reason briefly, and suggest alternatives if possible.`
    },
    {
        id: 'request-feedback',
        name: 'Requesting Feedback',
        category: 'Client Communication',
        icon: '📣',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'recipient', label: 'Recipient', placeholder: 'Sarah' },
            { id: 'about', label: 'Feedback on', placeholder: 'The design mockups shared last week' },
            { id: 'deadline', label: 'By when', placeholder: 'End of this week', optional: true }
        ],
        prompt: (fields) => `Write a professional email requesting feedback.
From: ${fields.name}
To: ${fields.recipient}
Feedback needed on: ${fields.about}
${fields.deadline ? 'By: ' + fields.deadline : ''}
Be polite and make it easy for them to respond. Keep it concise.`
    },
    {
        id: 'invoice-reminder',
        name: 'Sending Invoice Reminder',
        category: 'Client Communication',
        icon: '🧾',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'client', label: 'Client name', placeholder: 'John' },
            { id: 'invoice', label: 'Invoice number', placeholder: '#INV-2024-012' },
            { id: 'amount', label: 'Amount due', placeholder: '$1,200' }
        ],
        prompt: (fields) => `Write a friendly invoice reminder email.
From: ${fields.name}
To: ${fields.client}
Invoice: ${fields.invoice}
Amount: ${fields.amount}
Be polite but clear. This is a reminder, not a first notice.`
    },

    // ─── Job Hunting ───
    {
        id: 'cold-outreach',
        name: 'Cold Outreach to Recruiter',
        category: 'Job Hunting',
        icon: '🎯',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'recruiter', label: 'Recruiter name', placeholder: 'Sarah', optional: true },
            { id: 'role', label: 'Target role', placeholder: 'Senior Frontend Developer' },
            { id: 'experience', label: 'Key experience', placeholder: '5 years in React, led team of 4' }
        ],
        prompt: (fields) => `Write a compelling cold outreach message to a recruiter on LinkedIn.
From: ${fields.name}
${fields.recruiter ? 'To: ' + fields.recruiter : ''}
Target role: ${fields.role}
Experience: ${fields.experience}
Be confident, concise, and engaging. Show value immediately.`
    },
    {
        id: 'thank-you-interview',
        name: 'Thank You After Interview',
        category: 'Job Hunting',
        icon: '🤝',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'interviewer', label: 'Interviewer name', placeholder: 'Sarah' },
            { id: 'role', label: 'Role interviewed for', placeholder: 'Product Designer' },
            { id: 'highlight', label: 'Something discussed you liked', placeholder: 'The team culture and remote-first approach' }
        ],
        prompt: (fields) => `Write a thank-you email after a job interview.
From: ${fields.name}
Interviewer: ${fields.interviewer}
Role: ${fields.role}
Highlight: ${fields.highlight}
Be genuine, reference something specific from the conversation. Express enthusiasm for the role.`
    },
    {
        id: 'negotiate-salary',
        name: 'Negotiating Salary',
        category: 'Job Hunting',
        icon: '💼',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'role', label: 'Role offered', placeholder: 'Senior Engineer' },
            { id: 'offered', label: 'Offered salary', placeholder: '$120,000' },
            { id: 'expected', label: 'Your expectation', placeholder: '$140,000' }
        ],
        prompt: (fields) => `Write a salary negotiation email after receiving a job offer.
From: ${fields.name}
Role: ${fields.role}
Offered: ${fields.offered}
Expected: ${fields.expected}
Be grateful, professional, and confident. Justify the ask with market data or experience.`
    },
    {
        id: 'feedback-after-rejection',
        name: 'Asking for Feedback After Rejection',
        category: 'Job Hunting',
        icon: '📩',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'company', label: 'Company name', placeholder: 'Acme Inc' },
            { id: 'role', label: 'Role applied for', placeholder: 'Product Manager' }
        ],
        prompt: (fields) => `Write a graceful email asking for feedback after a job rejection.
From: ${fields.name}
Company: ${fields.company}
Role: ${fields.role}
Be professional, express continued interest, and politely ask what you could improve.`
    },
    {
        id: 'accept-offer',
        name: 'Accepting a Job Offer',
        category: 'Job Hunting',
        icon: '✅',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'company', label: 'Company name', placeholder: 'Acme Inc' },
            { id: 'role', label: 'Role', placeholder: 'Software Engineer' },
            { id: 'start_date', label: 'Start date', placeholder: 'April 1, 2026' }
        ],
        prompt: (fields) => `Write a professional email accepting a job offer.
From: ${fields.name}
Company: ${fields.company}
Role: ${fields.role}
Start date: ${fields.start_date}
Express enthusiasm and gratitude. Confirm the start date and next steps.`
    },
    {
        id: 'decline-offer',
        name: 'Declining a Job Offer Politely',
        category: 'Job Hunting',
        icon: '🙅',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'company', label: 'Company name', placeholder: 'Acme Inc' },
            { id: 'role', label: 'Role offered', placeholder: 'Backend Developer' },
            { id: 'reason', label: 'Brief reason', placeholder: 'Accepted another opportunity', optional: true }
        ],
        prompt: (fields) => `Write a polite email declining a job offer.
From: ${fields.name}
Company: ${fields.company}
Role: ${fields.role}
${fields.reason ? 'Reason: ' + fields.reason : ''}
Be gracious and professional. Leave the door open for future opportunities.`
    },

    // ─── Daily Messages ───
    {
        id: 'apologize-late',
        name: 'Apologizing for Being Late',
        category: 'Daily Messages',
        icon: '⏱️',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'context', label: 'Context', placeholder: 'Meeting / class / appointment' },
            { id: 'reason', label: 'Reason', placeholder: 'Traffic delay', optional: true }
        ],
        prompt: (fields) => `Write a brief, sincere apology for being late.
From: ${fields.name}
Late to: ${fields.context}
${fields.reason ? 'Reason: ' + fields.reason : ''}
Keep it short, sincere, and professional. Don't over-explain.`
    },
    {
        id: 'ask-help',
        name: 'Asking for Help Politely',
        category: 'Daily Messages',
        icon: '🙏',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'recipient', label: 'Who you are asking', placeholder: 'colleague / friend / professor' },
            { id: 'help_with', label: 'What you need help with', placeholder: 'Reviewing my presentation slides' }
        ],
        prompt: (fields) => `Write a polite message asking for help.
From: ${fields.name}
Asking: ${fields.recipient}
Help with: ${fields.help_with}
Be respectful of their time. Make the request specific and easy to say yes to.`
    },
    {
        id: 'saying-no',
        name: 'Saying No Without Offending',
        category: 'Daily Messages',
        icon: '🛑',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'request', label: 'What you are saying no to', placeholder: 'Weekend work / extra project / social event' },
            { id: 'reason', label: 'Brief reason', placeholder: 'Prior commitments', optional: true }
        ],
        prompt: (fields) => `Write a polite but firm message declining a request without offending.
From: ${fields.name}
Declining: ${fields.request}
${fields.reason ? 'Reason: ' + fields.reason : ''}
Be kind but clear. Don't leave room for ambiguity. Suggest an alternative if possible.`
    },
    {
        id: 'follow-up-no-response',
        name: 'Following Up (no response)',
        category: 'Daily Messages',
        icon: '🔔',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'recipient', label: 'Recipient', placeholder: 'Sarah' },
            { id: 'original_topic', label: 'Original topic', placeholder: 'The project proposal I sent last week' }
        ],
        prompt: (fields) => `Write a polite follow-up message when someone hasn't responded.
From: ${fields.name}
To: ${fields.recipient}
Original topic: ${fields.original_topic}
Be warm and not pushy. Gently remind them and make it easy to respond.`
    },
    {
        id: 'introduce-yourself',
        name: 'Introducing Yourself',
        category: 'Daily Messages',
        icon: '👋',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'context', label: 'Context', placeholder: 'New team member / conference / networking event' },
            { id: 'about', label: 'Key things about you', placeholder: 'Frontend developer, 3 years experience, based in Bangalore' }
        ],
        prompt: (fields) => `Write a friendly self-introduction message.
From: ${fields.name}
Context: ${fields.context}
About me: ${fields.about}
Be warm, confident, and concise. Show personality but stay professional.`
    },

    // ─── Work Emails (additional) ───
    {
        id: 'performance-review-request',
        name: 'Request Performance Review',
        category: 'Work Emails',
        icon: '📈',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'role', label: 'Your role', placeholder: 'Senior Developer' },
            { id: 'period', label: 'Review period', placeholder: 'last 6 months' },
            { id: 'manager', label: "Manager's name", placeholder: 'Sarah', optional: true }
        ],
        prompt: (fields) => `Write a professional email requesting a performance review.
From: ${fields.name}, ${fields.role}
Review period: ${fields.period}
${fields.manager ? "Manager: " + fields.manager : ''}
Be respectful, mention key accomplishments, and express eagerness to get feedback.`
    },
    {
        id: 'onboarding-intro',
        name: 'First Day Introduction Email',
        category: 'Work Emails',
        icon: '👋',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash Kumar' },
            { id: 'role', label: 'Your new role', placeholder: 'Product Manager' },
            { id: 'team', label: 'Team you joined', placeholder: 'Growth team' },
            { id: 'prev_role', label: 'Previous background', placeholder: 'worked at a startup for 3 years', optional: true }
        ],
        prompt: (fields) => `Write a warm and professional first-day introduction email to my new team.
My name: ${fields.name}
New role: ${fields.role}
Team: ${fields.team}
${fields.prev_role ? 'Background: ' + fields.prev_role : ''}
Make it friendly, concise, and mention excitement about joining. No corporate clichés.`
    },
    {
        id: 'sick-leave',
        name: 'Sick Leave Notification',
        category: 'Work Emails',
        icon: '🤒',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'days', label: 'Number of days', placeholder: '2 days (today and tomorrow)' },
            { id: 'tasks', label: 'Key pending work', placeholder: 'Client presentation draft', optional: true }
        ],
        prompt: (fields) => `Write a professional sick leave notification email.
From: ${fields.name}
Days: ${fields.days}
${fields.tasks ? 'Pending work: ' + fields.tasks : ''}
Keep it brief, professional, and mention how urgent work will be handled if needed.`
    },
    // ─── Client Communication (additional) ───
    {
        id: 'scope-change-request',
        name: 'Requesting Scope Change',
        category: 'Client Communication',
        icon: '🔄',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'project', label: 'Project name', placeholder: 'E-commerce Redesign' },
            { id: 'change', label: 'What changed', placeholder: 'Added payment gateway integration requirement' },
            { id: 'impact', label: 'Timeline/cost impact', placeholder: '2 extra weeks and $800 additional' }
        ],
        prompt: (fields) => `Write a professional email to a client requesting a scope change approval.
From: ${fields.name}
Project: ${fields.project}
Change: ${fields.change}
Impact: ${fields.impact}
Be transparent, solution-oriented, and maintain a positive tone.`
    },
    {
        id: 'project-completion',
        name: 'Project Completion Notice',
        category: 'Client Communication',
        icon: '🎉',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'client', label: "Client's name", placeholder: 'Mr. Ramesh' },
            { id: 'project', label: 'Project name', placeholder: 'Website Redesign' },
            { id: 'deliverables', label: 'Key deliverables', placeholder: 'live website, documentation, source code' }
        ],
        prompt: (fields) => `Write a professional project completion email to a client.
From: ${fields.name}
Client: ${fields.client}
Project: ${fields.project}
Deliverables: ${fields.deliverables}
Be warm, professional, summarize what was delivered, and offer continued support.`
    },
    {
        id: 'negative-feedback-response',
        name: 'Responding to Negative Feedback',
        category: 'Client Communication',
        icon: '🤝',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'issue', label: "Client's concern", placeholder: 'Delayed delivery and poor communication' },
            { id: 'resolution', label: 'What you will do', placeholder: 'Expedite delivery and set up weekly check-ins' }
        ],
        prompt: (fields) => `Write a professional and empathetic response to negative client feedback.
From: ${fields.name}
Issue raised: ${fields.issue}
Resolution: ${fields.resolution}
Acknowledge the issue genuinely, apologize without being defensive, and focus on solutions.`
    },
    // ─── Job Hunting (additional) ───
    {
        id: 'linkedin-connection',
        name: 'LinkedIn Connection Request Note',
        category: 'Job Hunting',
        icon: '🔗',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash Kumar' },
            { id: 'recipient', label: "Person you're connecting with", placeholder: 'Sarah Chen, Engineering Manager at Google' },
            { id: 'reason', label: 'Why connecting', placeholder: 'Interested in product roles at Google, admire her work on AI features' }
        ],
        prompt: (fields) => `Write a concise LinkedIn connection request note (under 200 characters).
From: ${fields.name}
To: ${fields.recipient}
Reason: ${fields.reason}
Make it personal, specific, and not salesy. No generic phrases.`
    },
    {
        id: 'job-referral-request',
        name: 'Asking for a Job Referral',
        category: 'Job Hunting',
        icon: '🤝',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'contact', label: "Contact's name", placeholder: 'Priya' },
            { id: 'company', label: 'Target company', placeholder: 'Razorpay' },
            { id: 'role', label: 'Role applying for', placeholder: 'Backend Engineer' }
        ],
        prompt: (fields) => `Write a professional and warm email asking for a job referral.
From: ${fields.name}
To: ${fields.contact}
Company: ${fields.company}
Role: ${fields.role}
Be respectful of their time, mention your relevant experience briefly, and make it easy to say yes or no.`
    },
    {
        id: 'counter-offer',
        name: 'Negotiating a Counter-Offer',
        category: 'Job Hunting',
        icon: '💼',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash Kumar' },
            { id: 'company', label: 'Company', placeholder: 'Infosys' },
            { id: 'offered', label: 'Offer received', placeholder: '₹18 LPA' },
            { id: 'target', label: 'Your target', placeholder: '₹22 LPA' },
            { id: 'reason', label: 'Justification', placeholder: '4 years experience, competing offer from Wipro' }
        ],
        prompt: (fields) => `Write a professional counter-offer negotiation email.
From: ${fields.name}
Company: ${fields.company}
Current offer: ${fields.offered}
Target: ${fields.target}
Justification: ${fields.reason}
Be confident but collaborative. Emphasize value, not demands.`
    },
    // ─── Daily Messages ───
    {
        id: 'whatsapp-apology',
        name: 'WhatsApp / Informal Apology',
        category: 'Daily Messages',
        icon: '💬',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'person', label: 'Person to apologise to', placeholder: 'my friend Priya' },
            { id: 'what', label: 'What happened', placeholder: 'forgot her birthday' }
        ],
        prompt: (fields) => `Write a warm, genuine informal apology message for WhatsApp or text.
From: ${fields.name}
To: ${fields.person}
What happened: ${fields.what}
Sound natural and sincere, not overly formal. Keep it short (2-3 sentences).`
    },
    {
        id: 'congratulations',
        name: 'Congratulations Message',
        category: 'Daily Messages',
        icon: '🎊',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'person', label: "Person's name", placeholder: 'Rahul' },
            { id: 'achievement', label: 'What they achieved', placeholder: 'got promoted to Senior Manager' }
        ],
        prompt: (fields) => `Write a warm congratulations message.
From: ${fields.name}
To: ${fields.person}
Achievement: ${fields.achievement}
Sound genuine, warm, and personal. Not generic. Keep it to 2-4 sentences.`
    },
    {
        id: 'check-in-message',
        name: 'Casual Check-In Message',
        category: 'Daily Messages',
        icon: '☀️',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'person', label: "Person's name", placeholder: 'my old colleague Raj' },
            { id: 'context', label: 'Why reaching out', placeholder: 'saw his LinkedIn post about new job', optional: true }
        ],
        prompt: (fields) => `Write a friendly, casual check-in message.
From: ${fields.name}
To: ${fields.person}
${fields.context ? 'Context: ' + fields.context : ''}
Sound warm and natural, not forced. 2-3 sentences.`
    },
    {
        id: 'birthday-wish',
        name: 'Birthday Wish (Professional)',
        category: 'Daily Messages',
        icon: '🎂',
        fields: [
            { id: 'person', label: "Person's name", placeholder: 'Priya' },
            { id: 'relation', label: 'Your relation', placeholder: 'my manager' },
            { id: 'personal', label: 'Personal touch', placeholder: 'she is about to launch her startup', optional: true }
        ],
        prompt: (fields) => `Write a warm but professional birthday message.
To: ${fields.person} (${fields.relation})
${fields.personal ? 'Personal note: ' + fields.personal : ''}
Make it sincere and warm, not overly formal. 2-3 sentences.`
    },
    // ─── Client Communication ───
    {
        id: 'testimonial-request',
        name: 'Requesting a Testimonial',
        category: 'Client Communication',
        icon: '⭐',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'client', label: "Client's name", placeholder: 'Mr. Mehta' },
            { id: 'project', label: 'Project completed', placeholder: 'Brand identity redesign' },
            { id: 'platform', label: 'Platform', placeholder: 'Google Reviews or LinkedIn', optional: true }
        ],
        prompt: (fields) => `Write a polite email requesting a testimonial or review.
From: ${fields.name}
Client: ${fields.client}
Project: ${fields.project}
${fields.platform ? 'Platform: ' + fields.platform : ''}
Be warm, grateful, make it easy for them, and keep it short.`
    },
    {
        id: 'service-quote',
        name: 'Sending a Service Quote',
        category: 'Client Communication',
        icon: '📋',
        fields: [
            { id: 'name', label: 'Your name', placeholder: 'Akash' },
            { id: 'client', label: "Client's name", placeholder: 'Ms. Sharma' },
            { id: 'service', label: 'Service offered', placeholder: 'Website development and SEO' },
            { id: 'price', label: 'Quote amount', placeholder: '₹45,000 for the full project' },
            { id: 'timeline', label: 'Timeline', placeholder: '4 weeks' }
        ],
        prompt: (fields) => `Write a professional email sending a service quote.
From: ${fields.name}
Client: ${fields.client}
Service: ${fields.service}
Quote: ${fields.price}
Timeline: ${fields.timeline}
Be confident, clear about what's included, and invite questions.`
    },
];

const TEMPLATE_CATEGORIES = [
    { name: 'Work Emails', icon: '📁', expanded: true },
    { name: 'Client Communication', icon: '📁', expanded: false },
    { name: 'Job Hunting', icon: '📁', expanded: false },
    { name: 'Daily Messages', icon: '📁', expanded: false }
];
