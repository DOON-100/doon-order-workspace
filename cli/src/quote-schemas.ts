// Generated from the server's Zod inputs. Run scripts/generate-cli-quote-schemas.mjs.
import type {WriteSchema} from './write-input.js';
export const quoteSchemas={
  "ie": {
    "id": {
      "type": "string",
      "min": 1,
      "max": 120
    },
    "version": {
      "type": "number",
      "integer": true,
      "min": 0
    },
    "customerAccountId": {
      "type": "string",
      "min": 1,
      "max": 120,
      "required": true
    },
    "quoteNo": {
      "type": "string",
      "max": 120
    },
    "quoteDate": {
      "type": "string"
    },
    "validUntil": {
      "type": "string"
    },
    "batchId": {
      "type": "string",
      "max": 120
    },
    "exchangeRateCnyPerUsd": {
      "type": "number",
      "min": 0,
      "max": 100000000,
      "required": true,
      "nullable": true
    },
    "exchangeRateDate": {
      "type": "string"
    },
    "exchangeRateSource": {
      "type": "string",
      "max": 1000
    },
    "notes": {
      "type": "string",
      "max": 8000
    },
    "lines": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "min": 1,
            "max": 120,
            "required": true
          },
          "model": {
            "type": "string",
            "max": 200
          },
          "customerModel": {
            "type": "string",
            "max": 200
          },
          "color": {
            "type": "string",
            "max": 200
          },
          "drawingNo": {
            "type": "string",
            "max": 200
          },
          "drawingRevision": {
            "type": "string",
            "max": 200
          },
          "quantityMin": {
            "type": "number",
            "integer": true,
            "min": 0,
            "max": 10000000,
            "required": true,
            "nullable": true
          },
          "quantityMax": {
            "type": "number",
            "integer": true,
            "min": 0,
            "max": 10000000,
            "required": true,
            "nullable": true
          },
          "structureNotes": {
            "type": "string",
            "max": 4000
          },
          "scopeNotes": {
            "type": "string",
            "max": 4000
          },
          "materials": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "min": 1,
                  "max": 120,
                  "required": true
                },
                "name": {
                  "type": "string",
                  "max": 240
                },
                "specification": {
                  "type": "string",
                  "max": 1000
                },
                "unit": {
                  "type": "string",
                  "max": 40
                },
                "basePrice": {
                  "type": "number",
                  "min": 0,
                  "max": 100000000,
                  "required": true,
                  "nullable": true
                },
                "usage": {
                  "type": "number",
                  "min": 0,
                  "max": 100000000,
                  "required": true,
                  "nullable": true
                },
                "coefficient": {
                  "type": "number",
                  "min": 0,
                  "max": 100000000,
                  "required": true,
                  "nullable": true
                },
                "lossRate": {
                  "type": "number",
                  "min": 0.1,
                  "max": 10
                },
                "lossAdjustmentReason": {
                  "type": "string",
                  "max": 1000
                },
                "notApplicable": {
                  "type": "boolean",
                  "required": true
                },
                "notes": {
                  "type": "string",
                  "max": 4000
                },
                "nameReference": {
                  "type": "object",
                  "properties": {
                    "catalogId": {
                      "type": "string",
                      "min": 1,
                      "max": 120,
                      "required": true
                    },
                    "catalogVersion": {
                      "type": "number",
                      "integer": true,
                      "min": 0,
                      "required": true
                    },
                    "entryId": {
                      "type": "string",
                      "min": 1,
                      "max": 120,
                      "required": true
                    }
                  }
                },
                "catalogId": {
                  "type": "string",
                  "max": 120
                },
                "catalogVersion": {
                  "type": "number",
                  "integer": true,
                  "min": 0,
                  "nullable": true
                },
                "priceSource": {
                  "type": "string",
                  "max": 1000
                }
              },
              "required": true
            },
            "max": 200,
            "required": true
          },
          "processes": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "min": 1,
                  "max": 120,
                  "required": true
                },
                "name": {
                  "type": "string",
                  "max": 240
                },
                "parentId": {
                  "type": "string",
                  "max": 120
                },
                "sequence": {
                  "type": "number",
                  "integer": true,
                  "min": 0,
                  "max": 10000,
                  "required": true
                },
                "standardSeconds": {
                  "type": "number",
                  "min": 0,
                  "max": 100000000,
                  "required": true,
                  "nullable": true
                },
                "basePrice": {
                  "type": "number",
                  "min": 0,
                  "max": 100000000,
                  "required": true,
                  "nullable": true
                },
                "difficulty": {
                  "type": "number",
                  "min": 0,
                  "max": 100000000,
                  "required": true,
                  "nullable": true
                },
                "usage": {
                  "type": "number",
                  "min": 0,
                  "max": 100000000,
                  "nullable": true
                },
                "notApplicable": {
                  "type": "boolean",
                  "required": true
                },
                "notes": {
                  "type": "string",
                  "max": 4000
                },
                "catalogId": {
                  "type": "string",
                  "max": 120
                },
                "catalogVersion": {
                  "type": "number",
                  "integer": true,
                  "min": 0,
                  "nullable": true
                },
                "priceSource": {
                  "type": "string",
                  "max": 1000
                }
              },
              "required": true
            },
            "max": 300,
            "required": true
          },
          "outsourcing": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "min": 1,
                  "max": 120,
                  "required": true
                },
                "category": {
                  "type": "string",
                  "enum": [
                    "plating",
                    "general"
                  ],
                  "required": true
                },
                "name": {
                  "type": "string",
                  "max": 240
                },
                "part": {
                  "type": "string",
                  "max": 240
                },
                "unitPrice": {
                  "type": "number",
                  "min": 0,
                  "max": 100000000,
                  "required": true,
                  "nullable": true
                },
                "usage": {
                  "type": "number",
                  "min": 0,
                  "max": 100000000,
                  "nullable": true
                },
                "notApplicable": {
                  "type": "boolean",
                  "required": true
                },
                "notes": {
                  "type": "string",
                  "max": 4000
                },
                "catalogId": {
                  "type": "string",
                  "max": 120
                },
                "catalogVersion": {
                  "type": "number",
                  "integer": true,
                  "min": 0,
                  "nullable": true
                },
                "priceSource": {
                  "type": "string",
                  "max": 1000
                }
              },
              "required": true
            },
            "max": 100,
            "required": true
          }
        },
        "required": true
      },
      "min": 1,
      "max": 100,
      "required": true
    },
    "tooling": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "min": 1,
            "max": 120,
            "required": true
          },
          "toolingId": {
            "type": "string",
            "max": 120
          },
          "name": {
            "type": "string",
            "max": 240
          },
          "lineIds": {
            "type": "array",
            "items": {
              "type": "string",
              "min": 1,
              "max": 120,
              "required": true
            },
            "max": 100,
            "required": true
          },
          "amount": {
            "type": "number",
            "min": 0,
            "max": 100000000,
            "required": true,
            "nullable": true
          },
          "chargeMode": {
            "type": "string",
            "enum": [
              "charge",
              "already_charged",
              "included_in_batch",
              "not_applicable"
            ],
            "required": true
          },
          "chargeQuoteId": {
            "type": "string",
            "max": 120
          },
          "chargeVersion": {
            "type": "number",
            "integer": true,
            "min": 0,
            "nullable": true
          },
          "evidence": {
            "type": "string",
            "max": 4000
          },
          "notes": {
            "type": "string",
            "max": 4000
          }
        },
        "required": true
      },
      "max": 100,
      "required": true
    },
    "manualAdjustments": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "target": {
            "type": "string",
            "min": 1,
            "max": 1000,
            "required": true
          },
          "value": {
            "type": "number",
            "min": 0,
            "max": 100000000,
            "required": true
          },
          "reason": {
            "type": "string",
            "min": 1,
            "max": 1000,
            "required": true
          },
          "sourceSignature": {
            "type": "string",
            "required": true
          }
        },
        "required": true
      },
      "max": 60000
    }
  },
  "customer": {
    "id": {
      "type": "string",
      "max": 100,
      "min": 1
    },
    "version": {
      "type": "number",
      "integer": true,
      "min": 0
    },
    "companyEn": {
      "type": "string",
      "max": 240,
      "min": 1,
      "required": true
    },
    "companyZh": {
      "type": "string",
      "max": 240,
      "min": 1,
      "required": true
    },
    "collectionEn": {
      "type": "string",
      "max": 240
    },
    "collectionZh": {
      "type": "string",
      "max": 240
    },
    "customerCode": {
      "type": "string",
      "max": 80,
      "required": true
    },
    "customerName": {
      "type": "string",
      "max": 200,
      "min": 1,
      "required": true
    },
    "customerAccountId": {
      "type": "string",
      "max": 120,
      "min": 1,
      "nullable": true
    },
    "contactName": {
      "type": "string",
      "max": 200
    },
    "brand": {
      "type": "string",
      "max": 240
    },
    "businessType": {
      "type": "string",
      "max": 120
    },
    "quoteMode": {
      "type": "string",
      "enum": [
        "order",
        "price_list"
      ]
    },
    "pricingBasis": {
      "type": "string",
      "enum": [
        "row_item",
        "whole_model",
        "pending"
      ]
    },
    "currencyReviewed": {
      "type": "boolean"
    },
    "quoteNo": {
      "type": "string",
      "max": 120,
      "min": 1,
      "required": true
    },
    "quoteDate": {
      "type": "string",
      "required": true
    },
    "validUntil": {
      "type": "string",
      "required": true
    },
    "currency": {
      "type": "string",
      "required": true
    },
    "internalNotesZh": {
      "type": "string",
      "max": 8000
    },
    "exchangeRateCnyPerUsd": {
      "type": "number",
      "min": 0,
      "max": 10000,
      "nullable": true
    },
    "internalCosts": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "max": 100,
            "min": 1,
            "required": true
          },
          "label": {
            "type": "string",
            "max": 240,
            "min": 1,
            "required": true
          },
          "rmb": {
            "type": "number",
            "min": 0,
            "max": 1000000000,
            "required": true
          },
          "notes": {
            "type": "string",
            "max": 4000
          }
        },
        "required": true
      },
      "max": 50
    },
    "customerCharges": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "max": 100,
            "min": 1,
            "required": true
          },
          "labelZh": {
            "type": "string",
            "max": 240,
            "min": 1,
            "required": true
          },
          "labelEn": {
            "type": "string",
            "max": 240,
            "min": 1,
            "required": true
          },
          "amount": {
            "type": "number",
            "min": 0,
            "max": 1000000000,
            "required": true,
            "nullable": true
          },
          "basisZh": {
            "type": "string",
            "max": 500,
            "required": true
          },
          "basisEn": {
            "type": "string",
            "max": 500,
            "required": true
          },
          "conditional": {
            "type": "boolean",
            "required": true
          },
          "needsReview": {
            "type": "boolean",
            "required": true
          }
        },
        "required": true
      },
      "max": 50
    },
    "lines": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "max": 100,
            "min": 1,
            "required": true
          },
          "model": {
            "type": "string",
            "max": 200,
            "min": 1,
            "required": true
          },
          "descriptionZh": {
            "type": "string",
            "max": 4000,
            "required": true
          },
          "descriptionEn": {
            "type": "string",
            "max": 4000,
            "required": true
          },
          "factoryModel": {
            "type": "string",
            "max": 200
          },
          "customerModel": {
            "type": "string",
            "max": 200
          },
          "materialNumber": {
            "type": "string",
            "max": 240
          },
          "productType": {
            "type": "string",
            "enum": [
              "frame",
              "spare_part",
              "unknown"
            ]
          },
          "component": {
            "type": "string",
            "max": 240
          },
          "side": {
            "type": "string",
            "enum": [
              "left",
              "right",
              "none"
            ]
          },
          "supplyStage": {
            "type": "string",
            "enum": [
              "raw",
              "semi_finished",
              "finished",
              "unknown"
            ]
          },
          "unit": {
            "type": "string",
            "enum": [
              "piece",
              "pair",
              "set",
              "unknown"
            ]
          },
          "scopeReviewed": {
            "type": "boolean"
          },
          "scopeNotesZh": {
            "type": "string",
            "max": 2000
          },
          "scopeNotesEn": {
            "type": "string",
            "max": 2000
          },
          "quantity": {
            "type": "number",
            "integer": true,
            "min": 0,
            "max": 10000000,
            "required": true,
            "nullable": true
          },
          "unitPrice": {
            "type": "number",
            "min": 0,
            "max": 1000000000,
            "required": true,
            "nullable": true
          },
          "toolingFee": {
            "type": "number",
            "min": 0,
            "max": 1000000000,
            "required": true,
            "nullable": true
          },
          "sourceFormula": {
            "type": "string",
            "max": 500
          },
          "quantityBasisZh": {
            "type": "string",
            "max": 200
          },
          "quantityBasisEn": {
            "type": "string",
            "max": 200
          }
        },
        "required": true
      },
      "min": 1,
      "max": 200,
      "required": true
    },
    "terms": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "max": 100,
            "min": 1,
            "required": true
          },
          "labelZh": {
            "type": "string",
            "max": 200,
            "min": 1,
            "required": true
          },
          "labelEn": {
            "type": "string",
            "max": 200,
            "min": 1,
            "required": true
          },
          "zh": {
            "type": "string",
            "max": 8000,
            "required": true
          },
          "en": {
            "type": "string",
            "max": 8000,
            "required": true
          },
          "needsReview": {
            "type": "boolean",
            "required": true
          },
          "reviewNote": {
            "type": "string",
            "max": 4000
          }
        },
        "required": true
      },
      "max": 50,
      "required": true
    },
    "reviewNotes": {
      "type": "array",
      "items": {
        "type": "string",
        "max": 4000,
        "required": true
      },
      "max": 50,
      "required": true
    }
  },
  "prices": {
    "schemaVersion": {
      "type": "number",
      "enum": [
        1
      ],
      "required": true
    },
    "customer": {
      "type": "object",
      "properties": {
        "code": {
          "type": "string",
          "min": 1,
          "max": 240,
          "required": true
        },
        "name": {
          "type": "string",
          "min": 1,
          "max": 240,
          "required": true
        }
      },
      "required": true
    },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "min": 1,
            "max": 240,
            "required": true
          },
          "relativePath": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "path": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "sha256": {
            "type": "string",
            "nullable": true
          },
          "category": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "status": {
            "type": "string",
            "max": 8000,
            "nullable": true
          }
        },
        "required": true
      },
      "max": 20000,
      "required": true
    },
    "products": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "min": 1,
            "max": 240,
            "required": true
          },
          "factoryModel": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "customerModel": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "productName": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "productType": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "sku": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "frameColor": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "lens": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "material": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "size": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "specVersion": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "activity": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "sourceRefs": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "fileId": {
                  "type": "string",
                  "min": 1,
                  "max": 240,
                  "required": true
                },
                "sheet": {
                  "type": "string",
                  "max": 8000,
                  "nullable": true
                },
                "cell": {
                  "type": "string",
                  "max": 8000,
                  "nullable": true
                },
                "page": {
                  "type": "number",
                  "integer": true,
                  "min": 0,
                  "nullable": true
                }
              },
              "required": true
            },
            "max": 1000
          }
        },
        "required": true
      },
      "max": 100000,
      "required": true
    },
    "prices": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "min": 1,
            "max": 240,
            "required": true
          },
          "productId": {
            "type": "string",
            "min": 1,
            "max": 240,
            "required": true
          },
          "scope": {
            "type": "string",
            "enum": [
              "sku",
              "model"
            ],
            "required": true
          },
          "documentType": {
            "type": "string",
            "enum": [
              "invoice",
              "quote",
              "order",
              "internal",
              "charge"
            ],
            "required": true
          },
          "documentNo": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "version": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "documentDate": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "currency": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "unit": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "configuration": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "lensVariant": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "invoiceKind": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "quantity": {
            "type": "number",
            "min": 0,
            "max": 1000000000000,
            "nullable": true
          },
          "quantityMin": {
            "type": "number",
            "min": 0,
            "max": 1000000000000,
            "nullable": true
          },
          "quantityMax": {
            "type": "number",
            "min": 0,
            "max": 1000000000000,
            "nullable": true
          },
          "quantityBasis": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "unitPrice": {
            "type": "number",
            "min": 0,
            "max": 1000000000000,
            "nullable": true
          },
          "toolingFee": {
            "type": "number",
            "min": 0,
            "max": 1000000000000,
            "nullable": true
          },
          "otherCharges": {
            "type": "json"
          },
          "terms": {
            "type": "string",
            "max": 8000,
            "nullable": true
          },
          "reviewStatus": {
            "type": "string",
            "enum": [
              "verified",
              "needs_review"
            ],
            "required": true
          },
          "sentStatus": {
            "type": "string",
            "enum": [
              "unknown",
              "sent"
            ],
            "required": true
          },
          "sourceRefs": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "fileId": {
                  "type": "string",
                  "min": 1,
                  "max": 240,
                  "required": true
                },
                "sheet": {
                  "type": "string",
                  "max": 8000,
                  "nullable": true
                },
                "cell": {
                  "type": "string",
                  "max": 8000,
                  "nullable": true
                },
                "page": {
                  "type": "number",
                  "integer": true,
                  "min": 0,
                  "nullable": true
                }
              },
              "required": true
            },
            "max": 1000
          },
          "notes": {
            "type": "string",
            "max": 8000,
            "nullable": true
          }
        },
        "required": true
      },
      "max": 100000,
      "required": true
    },
    "issues": {
      "type": "array",
      "items": {
        "type": "json",
        "nullable": true
      },
      "max": 100000
    },
    "excluded": {
      "type": "array",
      "items": {
        "type": "json",
        "nullable": true
      },
      "max": 20000
    }
  }
} satisfies Record<string,WriteSchema>;
