export const RFQ_TEMPLATES = [
  {
    key: 'rfq-standard',
    name: 'RFQ — standard request',
    subject: 'Request for quote — {{rfq_item}} ({{company}})',
    text: `Hi {{first_name}},

I'm {{sender_name}} at {{sender_company}}. We are requesting a quote for:

Item: {{rfq_item}}
Quantity: {{rfq_qty}}
Needed by: {{rfq_needed_by}}

Please send unit pricing, MOQ, lead time, and any tooling costs to {{sender_email}}.

Thank you,
{{sender_name}}
{{sender_title}}
{{sender_company}}
{{physical_address}}`,
    html: `<p>Hi {{first_name}},</p>
<p>I'm {{sender_name}} at {{sender_company}}. We are requesting a quote for:</p>
<ul>
  <li><strong>Item:</strong> {{rfq_item}}</li>
  <li><strong>Quantity:</strong> {{rfq_qty}}</li>
  <li><strong>Needed by:</strong> {{rfq_needed_by}}</li>
</ul>
<p>Please send unit pricing, MOQ, lead time, and any tooling costs to <a href="mailto:{{sender_email}}">{{sender_email}}</a>.</p>
<p>Thank you,<br>{{sender_name}}<br>{{sender_title}}<br>{{sender_company}}<br>{{physical_address}}</p>`,
  },
  {
    key: 'rfq-followup',
    name: 'RFQ — polite follow-up',
    subject: 'Following up: quote for {{rfq_item}}',
    text: `Hi {{first_name}},

Just circling back on the request I sent for {{rfq_item}} (qty {{rfq_qty}}).

If now is not a fit, a quick "no" is helpful so I can close the file. If you can quote, reply with pricing and lead time.

Best,
{{sender_name}}
{{sender_company}}`,
    html: `<p>Hi {{first_name}},</p>
<p>Just circling back on the request I sent for <strong>{{rfq_item}}</strong> (qty {{rfq_qty}}).</p>
<p>If now is not a fit, a quick "no" is helpful so I can close the file. If you can quote, reply with pricing and lead time.</p>
<p>Best,<br>{{sender_name}}<br>{{sender_company}}</p>`,
  },
  {
    key: 'rfq-intro',
    name: 'RFQ — short intro',
    subject: '{{first_name}} — quote request from {{sender_company}}',
    text: `{{first_name}}, quick note from {{sender_name}} at {{sender_company}}.

We're sourcing {{rfq_item}} and {{company}} came up as a possible supplier. Would you be the right person for a quote, or should I ask someone else?

{{sender_name}}
{{sender_email}}`,
    html: `<p>{{first_name}}, quick note from {{sender_name}} at {{sender_company}}.</p>
<p>We're sourcing <strong>{{rfq_item}}</strong> and {{company}} came up as a possible supplier. Would you be the right person for a quote, or should I ask someone else?</p>
<p>{{sender_name}}<br>{{sender_email}}</p>`,
  },
];

export function getRfqTemplate(key) {
  return RFQ_TEMPLATES.find((t) => t.key === key) || null;
}
