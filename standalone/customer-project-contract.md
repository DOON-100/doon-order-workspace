# Customer project API contract

No migration/initialization writes. Existing customer_account/order/customer_quote are read only. Team membership NEVER grants customer or quote access: project access intersects existing sales/service assignment. Types: lib/customer-projects.ts.

GET `customer-project-data` returns customers, teams, projects (with canWrite), items, rounds (with remainingScope), communications, tasks, drawings, confirmations, quoteLinks, samples, dispatches, feedback, handovers, attachments, orders (safe production summary), quotes (authorized confirmed-version candidates only), members (id/name/role), canManageTeams, canWrite. Internal-only staff get only own sample jobs, safe item snapshots, no project/quote/finance records.

All POST JSON schemas are strict. Updates use target `id,version`; append/create actions use UUID `token` except project/item/round/team save (token still required for creates). Result `{ok:true,item,idempotent?}`. Errors `{error}` with 400/403/409. All actions prefixed `customer-project-`:

| suffix | body |
|---|---|
| team-save | id?,version?,token?,name,leaderIds[],salesMemberIds[],serviceMemberIds[],customerIds[],active |
| save | id?,version?,token?,customerId,code,title,description,teamId,salesMemberId,serviceMemberId,dueDate,status(active/paused/cancelled/archived) |
| item-save | id?,version?,token?,projectId,model,customerModel,drawing,color,lens,material,requirements,quantity |
| round-save | id?,version?,token?,projectId,title,type(development/revision/sales_sample/preproduction/bulk),parentRoundId,scope:[{itemId,quantity}],stage,requiredDrawingTypes:[2d/3d],requireQuote:boolean,requiredSampleIds[],sampleGateStage(order/before_production/not_required),sampleGateNote,dueDate,reason; cancellation via status=cancelled, derived partial/transferred cannot be set |
| communication | token,projectId,roundId,channel,contact,occurredAt(YYYY-MM-DD),content,nextAction,ownerId,dueDate,visibility(internal/customer),attachmentIds[] |
| task-save | id?,version?,token?,projectId,roundId,title,description,ownerId,waitingFor,dueDate,status(open/done/cancelled),result |
| drawing | token,projectId,roundId,itemIds[],type(customer/2d/3d/artwork/packing),drawingNo,revision,previousId,pairedDrawingId,attachmentIds[],changeNote |
| drawing-withdraw | id,version,reason |
| confirmation | token,projectId,roundId,drawingId,itemIds[],decision(approved/conditional/rejected),contact,date,evidence,conditions,attachmentIds[] |
| quote-link | token,projectId,roundId,itemIds[],quoteId,quoteVersion,lineIds[],acceptedBy,acceptedDate,evidence |
| sample-release | token,projectId,roundId,roundVersion,purpose(development/revision/color/sales_sample/preproduction),scope:[{itemId,quantity}],drawingIds[],quoteLinkId,ownerId,requiredDate,note |
| sample-update | id,version,status(pending/accepted/making/qc/ready/closed/cancelled),plannedDate,note; only assigned internal staff/admin update execution |
| sample-promise | id,version,promisedDate,promiseNote; only project writers update customer promise |
| sample-dispatch | token,projectId,sampleId,lines:[{itemId,quantity}],carrier,trackingNo,recipient,address,shipDate,receivedDate,note,attachmentIds[] |
| dispatch-receive | id,version,receivedDate |
| sample-feedback | token,projectId,sampleId,itemId,decision(approved/conditional/revise/rejected),contact,date,evidence,note,attachmentIds[] |
| bulk-link | token,projectId,roundId,roundVersion,orderLinks:[{itemId,orderId,quantity,orderVersion}],drawingIds[],quoteLinkId; only existing non-draft same-customer formal order lines |

Optional string fields default empty, arrays default empty where appropriate. Server checks internal staff, customer/round/item/file relations, version, financial paymentGate and approved selected drawings before release. All quantity scopes are positive integers. Team save is admin-only organizational metadata; no old records changed. Sample execution jobs remain separate `customer_project_sample` records, NEVER flow into existing bulk PMC quantities.

Bulk lines must have sourceStatus exactly 正式订单 and not a draft business workflow; code does not change sourceStatus for the user. Required sample approval at order-stage checks every affected item. before_production creates explicit handover task naming the configured production checkpoint; this release does NOT automatically block original PMC operations. Sample dispatch counts manufactured quantity once: repair/resend cannot be disguised as new delivery; establish an explicit revision/new sample run for newly manufactured samples and preserve original dispatch.

Attachment POST `customer-project-attachment` uses FormData(projectId,roundId,file,note); 50 MB; PDF/images/office/CAD DWG DXF STEP STP IGES IGS STL/EML allowed. GET `customer-project-file?id=...` always checks current customer or assigned internal-job evidence access. GET `customer-project-history?projectId=...` scoped safe history, excludes quote content when quote authorization missing. New quote links store identities and accepted evidence, not costs or prices.
