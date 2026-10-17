// Adapt known UI copy from the pinned upstream bundle. Never replace identifiers,
// URLs, package names, API fields, user messages or arbitrary occurrences of Mastra.
const labels=new Map([
 ['Mastra Studio','Agent Studio'],
 ['Back to Mastra Studio','Back to Agent Studio'],
 ['Mastra Studio Search','Agent Studio Search'],
 ['Mastra Studio failed to start','Agent Studio failed to start'],
 ['Mastra Connection','Agent Connection'],
 ['Mastra instance URL','Agent instance URL'],
 ['Configure the Mastra instance URL, API prefix, and request headers used by the studio.','Configure the Agent instance URL, API prefix, and request headers used by the studio.'],
 ['Mastra APIs','Agent APIs'],
 ['Read the official Mastra documentation for guides, references, and tutorials.','Read the framework documentation for guides, references, and tutorials.'],
 ['Browse the source code, report issues, and contribute to the Mastra project.','Browse the framework source code, report issues, and contribute.'],
 ['Join the Mastra Discord community for help, discussion, and collaboration.','Join the framework developer community for help, discussion, and collaboration.'],
 ['Installed Mastra Packages','Installed Framework Packages'],
 ['View and update installed Mastra packages','View and update installed framework packages'],
 ['Mastra tools are not configured yet. ','Agent tools are not configured yet. '],
 ['Mastra workflows are not configured yet. ','Agent workflows are not configured yet. '],
 ['Add a workspace to your Mastra configuration to ','Add a workspace to your Agent configuration to '],
 ['Mastra configuration to manage files, skills, and enable semantic search.','Agent configuration to manage files, skills, and enable semantic search.'],
 ['Add the authorization header that Studio needs to reach your Mastra server.','Add the authorization header that Studio needs to reach your Agent server.'],
 ['Evaluating traces and saving them as dataset items is available in Mastra Studio (local or deployed).','Evaluating traces and saving them as dataset items is available in Agent Studio (local or deployed).'],
 ['. Its settings are defined in code on the Mastra instance and can\'t be edited here.','. Its settings are defined in code on the Agent instance and can\'t be edited here.'],
 ['Runs as a step of its parent workflow. Add it to the workflows of your Mastra instance to open, run, and inspect it on its own page.','Runs as a step of its parent workflow. Register it on your Agent instance to open, run, and inspect it on its own page.'],
 ['Open PR is available on Mastra-hosted projects with GitHub App support','Open PR requires a hosted project with GitHub App support'],
 ['Disconnecting revokes this authorized account and removes it from Mastra. Agents using this connection will lose access. This can’t be undone.','Disconnecting revokes this authorized account and removes it from Agent Studio. Agents using this connection will lose access. This can’t be undone.'],
]);

export function brandStudioScript(source){
 for(const [original,replacement] of labels)source=source.replaceAll(JSON.stringify(original),JSON.stringify(replacement));
 return source;
}
