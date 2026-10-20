import type {Member} from './domain';

/** Tool access follows the administrator role; owner marks only account protection. */
export function canUseFixedDataTools(member?:Pick<Member,'active'|'role'>):boolean{
 return member?.active===true&&member.role==='admin';
}
