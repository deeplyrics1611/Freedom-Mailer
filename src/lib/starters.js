// Starter copy for quote requests. These are written the way outreach that
// actually gets replies is written: short, plain, specific about what is being
// asked for, no images, no tracking, at most one link. Every merge field has a
// fallback so the message never renders as "Hi ,".

export const RFQ_TEMPLATES = [
  {
    id: 'rfq-direct',
    name: 'RFQ — direct quote request',
    description: 'Single-product enquiry with quantity and timeline. The safest first touch.',
    subject: 'Quote request: {{product|your product range}} ({{quantity|volume TBC}})',
    text: `Hi {{first_name|there}},

I'm sourcing {{product|components}} for {{my_company|our business}} and {{company|your company}} came up as a supplier worth approaching.

What we need:
- Item: {{product|(to be confirmed)}}
- Quantity: {{quantity|to be confirmed}}
- Delivery to: {{ship_to|our facility}}
- Needed by: {{needed_by|as soon as you can quote}}

Could you send unit pricing, lead time, and minimum order quantity? If you need drawings or a spec sheet, reply and I'll send them over.

Thanks,
{{my_name|}}
{{my_title|}}
{{my_company|}}
{{my_phone|}}`,
    html: `<p>Hi {{first_name|there}},</p>
<p>I'm sourcing {{product|components}} for {{my_company|our business}} and {{company|your company}} came up as a supplier worth approaching.</p>
<p><strong>What we need:</strong></p>
<ul>
  <li>Item: {{product|(to be confirmed)}}</li>
  <li>Quantity: {{quantity|to be confirmed}}</li>
  <li>Delivery to: {{ship_to|our facility}}</li>
  <li>Needed by: {{needed_by|as soon as you can quote}}</li>
</ul>
<p>Could you send unit pricing, lead time, and minimum order quantity? If you need drawings or a spec sheet, reply and I'll send them over.</p>
<p>Thanks,<br>{{my_name|}}<br>{{my_title|}}<br>{{my_company|}}<br>{{my_phone|}}</p>`,
  },
  {
    id: 'rfq-capability',
    name: 'RFQ — capability enquiry',
    description: 'For when you need to know whether they can make it before asking for a price.',
    subject: 'Do you handle {{process|this kind of work}}?',
    text: `Hi {{first_name|there}},

Quick question before I put a full RFQ together.

We need {{process|manufacturing}} for {{product|a component}} — roughly {{quantity|an ongoing volume}} per {{period|month}}, {{material|material to be confirmed}}.

Two things I need to know:
1. Is this within what {{company|your shop}} takes on?
2. What's your typical lead time at that volume?

If it's a fit I'll send the drawings and a formal RFQ the same day.

Thanks,
{{my_name|}}
{{my_company|}}`,
    html: `<p>Hi {{first_name|there}},</p>
<p>Quick question before I put a full RFQ together.</p>
<p>We need {{process|manufacturing}} for {{product|a component}} — roughly {{quantity|an ongoing volume}} per {{period|month}}, {{material|material to be confirmed}}.</p>
<p>Two things I need to know:</p>
<ol>
  <li>Is this within what {{company|your shop}} takes on?</li>
  <li>What's your typical lead time at that volume?</li>
</ol>
<p>If it's a fit I'll send the drawings and a formal RFQ the same day.</p>
<p>Thanks,<br>{{my_name|}}<br>{{my_company|}}</p>`,
  },
  {
    id: 'rfq-multi-line',
    name: 'RFQ — multi-line bill of materials',
    description: 'Several line items in one enquiry, laid out as a simple table.',
    subject: 'RFQ {{rfq_number|}} — {{line_count|several}} line items, {{needed_by|quote by return}}',
    text: `Hi {{first_name|there}},

Please quote the following for {{my_company|our business}}:

{{items|(line items to be supplied)}}

Delivery: {{ship_to|our facility}}
Required by: {{needed_by|to be confirmed}}
Payment terms: {{terms|open to discussion}}

Please include unit price, MOQ, lead time and validity period per line. Partial quotes are fine — quote what you can supply.

Thanks,
{{my_name|}}
{{my_company|}}`,
    html: `<p>Hi {{first_name|there}},</p>
<p>Please quote the following for {{my_company|our business}}:</p>
<table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse;font-family:inherit;font-size:14px">
  <tr>
    <td style="border-bottom:1px solid #ddd"><strong>Item</strong></td>
    <td style="border-bottom:1px solid #ddd"><strong>Quantity</strong></td>
  </tr>
  <tr>
    <td style="border-bottom:1px solid #eee">{{product|(to be confirmed)}}</td>
    <td style="border-bottom:1px solid #eee">{{quantity|TBC}}</td>
  </tr>
</table>
<p>Delivery: {{ship_to|our facility}}<br>
Required by: {{needed_by|to be confirmed}}<br>
Payment terms: {{terms|open to discussion}}</p>
<p>Please include unit price, MOQ, lead time and validity period per line. Partial quotes are fine — quote what you can supply.</p>
<p>Thanks,<br>{{my_name|}}<br>{{my_company|}}</p>`,
  },
  {
    id: 'rfq-followup',
    name: 'Follow-up — one nudge, then stop',
    description: 'A single polite follow-up. Send at most one, and honour any opt-out immediately.',
    subject: 'Re: quote request — {{product|our enquiry}}',
    text: `Hi {{first_name|there}},

Following up on the quote request I sent last week for {{product|the items below}}.

If it's not something {{company|you}} supplies, just say so and I'll stop here. If it is, I still need pricing and lead time when you have a moment.

Thanks,
{{my_name|}}
{{my_company|}}`,
    html: `<p>Hi {{first_name|there}},</p>
<p>Following up on the quote request I sent last week for {{product|the items below}}.</p>
<p>If it's not something {{company|you}} supplies, just say so and I'll stop here. If it is, I still need pricing and lead time when you have a moment.</p>
<p>Thanks,<br>{{my_name|}}<br>{{my_company|}}</p>`,
    note: 'The Re: prefix is honest here only because you really did send a first message. Using it on a first touch is deceptive and is scored as such.',
  },
];
