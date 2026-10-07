/** Use the approved original artwork without recreating or recolouring the wordmark. */
export function CompanyLogo({className=''}:{className?:string}){
 return <img className={['company-logo',className].filter(Boolean).join(' ')} src="/brand/doon-eyewear-manufacturing.jpg" width={1580} height={632} alt="DOON Eyewear Manufacturing" decoding="async"/>;
}
