// Generated; server refinements remain authoritative.
import type {WriteSchema} from './write-input.js';
export const communicationSchemas={
  "account": {
    "id": {
      "type": "string",
      "min": 1,
      "max": 160
    },
    "channel": {
      "type": "string",
      "enum": [
        "email",
        "whatsapp"
      ],
      "required": true
    },
    "label": {
      "type": "string",
      "min": 1,
      "max": 120,
      "required": true
    },
    "address": {
      "type": "string",
      "min": 1,
      "max": 200,
      "required": true
    },
    "ownerId": {
      "type": "string",
      "min": 1,
      "max": 160,
      "required": true
    },
    "active": {
      "type": "boolean",
      "required": true
    },
    "reason": {
      "type": "string",
      "min": 1,
      "max": 3000,
      "required": true
    },
    "grants": {
      "type": "json"
    }
  },
  "message": {
    "id": {
      "type": "string",
      "min": 1,
      "max": 160
    },
    "accountId": {
      "type": "string",
      "min": 1,
      "max": 160,
      "required": true
    },
    "customerId": {
      "type": "string",
      "max": 160
    },
    "projectId": {
      "type": "string",
      "max": 160
    },
    "orderId": {
      "type": "string",
      "max": 160
    },
    "direction": {
      "type": "string",
      "enum": [
        "incoming",
        "outgoing"
      ],
      "required": true
    },
    "sender": {
      "type": "string",
      "max": 400
    },
    "recipient": {
      "type": "string",
      "max": 400
    },
    "conversationType": {
      "type": "string",
      "enum": [
        "direct",
        "customer_group",
        "internal_group"
      ],
      "required": true
    },
    "conversation": {
      "type": "string",
      "max": 400
    },
    "occurredAt": {
      "type": "string",
      "min": 1,
      "max": 30,
      "required": true
    },
    "title": {
      "type": "string",
      "min": 1,
      "max": 300,
      "required": true
    },
    "sourceText": {
      "type": "string",
      "max": 100000
    },
    "draftText": {
      "type": "string",
      "max": 100000
    },
    "sourceNote": {
      "type": "string",
      "max": 3000
    },
    "missingInfo": {
      "type": "string",
      "max": 3000
    }
  },
  "link": {
    "id": {
      "type": "string",
      "min": 1,
      "max": 160,
      "required": true
    },
    "customerId": {
      "type": "string",
      "min": 1,
      "max": 160,
      "required": true
    },
    "projectId": {
      "type": "string",
      "max": 160
    },
    "orderId": {
      "type": "string",
      "max": 160
    },
    "reason": {
      "type": "string",
      "min": 1,
      "max": 3000,
      "required": true
    }
  },
  "process": {
    "id": {
      "type": "string",
      "min": 1,
      "max": 160,
      "required": true
    },
    "processed": {
      "type": "boolean",
      "required": true
    }
  },
  "bind": {
    "id": {
      "type": "string",
      "min": 1,
      "max": 160,
      "required": true
    },
    "accountId": {
      "type": "string",
      "min": 1,
      "max": 160,
      "required": true
    },
    "reason": {
      "type": "string",
      "min": 1,
      "max": 3000,
      "required": true
    }
  },
  "receive": {
    "id": {
      "type": "string",
      "min": 1,
      "max": 160,
      "required": true
    }
  },
  "unified": {
    "id": {
      "type": "string",
      "min": 1,
      "max": 160
    },
    "customerId": {
      "type": "string",
      "min": 1,
      "max": 160,
      "required": true
    },
    "projectId": {
      "type": "string",
      "max": 160
    },
    "orderId": {
      "type": "string",
      "max": 160
    },
    "channel": {
      "type": "string",
      "enum": [
        "email",
        "whatsapp",
        "wechat",
        "phone",
        "meeting",
        "other"
      ],
      "required": true
    },
    "title": {
      "type": "string",
      "min": 1,
      "max": 300,
      "required": true
    },
    "sourceText": {
      "type": "string",
      "max": 100000
    },
    "sourceReference": {
      "type": "string",
      "max": 3000
    },
    "occurredAt": {
      "type": "string",
      "max": 10
    },
    "draftText": {
      "type": "string",
      "max": 100000
    },
    "internalNote": {
      "type": "string",
      "max": 10000
    }
  },
  "submit": {
    "id": {
      "type": "string",
      "min": 1,
      "max": 160,
      "required": true
    },
    "expectedSourceHash": {
      "type": "string",
      "required": true
    },
    "expectedContentHash": {
      "type": "string",
      "required": true
    },
    "comment": {
      "type": "string",
      "max": 6000
    }
  },
  "return": {
    "id": {
      "type": "string",
      "min": 1,
      "max": 160,
      "required": true
    },
    "expectedSourceHash": {
      "type": "string",
      "required": true
    },
    "expectedContentHash": {
      "type": "string",
      "required": true
    },
    "comment": {
      "type": "string",
      "min": 1,
      "max": 6000,
      "required": true
    }
  },
  "complete-review": {
    "id": {
      "type": "string",
      "min": 1,
      "max": 160,
      "required": true
    },
    "expectedSourceHash": {
      "type": "string",
      "required": true
    },
    "expectedContentHash": {
      "type": "string",
      "required": true
    },
    "comment": {
      "type": "string",
      "max": 6000
    }
  },
  "mailbox": {
    "memberId": {
      "type": "string",
      "min": 1,
      "max": 120,
      "required": true
    },
    "email": {
      "type": "string",
      "max": 254,
      "required": true
    },
    "confirmed": {
      "type": "boolean",
      "enum": [
        true
      ],
      "required": true
    }
  },
  "push": {
    "target": {
      "type": "string",
      "enum": [
        "engineering",
        "sales_approval"
      ]
    },
    "quoteId": {
      "type": "string",
      "min": 1,
      "max": 120,
      "required": true
    },
    "quoteVersion": {
      "type": "number",
      "integer": true,
      "min": 0,
      "required": true
    },
    "fingerprint": {
      "type": "string",
      "required": true
    }
  }
} satisfies Record<string,WriteSchema>;
export const knowledgeRuleIds=["rule-01","rule-02","rule-03","rule-04","rule-05","rule-06","rule-07","rule-08","rule-09","rule-10","rule-11","rule-12","rule-13","rule-14","rule-15","rule-16","rule-17","source-research","source-reply","source-nda","context-linking","context-review"] as const;
