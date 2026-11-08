// SPDX-License-Identifier: GPL-3.0-only
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading;

internal static class CapriPayloadInfo {
    internal static readonly string Sha256="",VoiceSha256="";
}

internal static class InstallerLauncherHarness {
    private static ProcessStartInfo Start(string args) {
        return new ProcessStartInfo(Assembly.GetExecutingAssembly().Location,args) {
            UseShellExecute=false,CreateNoWindow=true
        };
    }

    private static void Check(bool condition,string message) {
        if(!condition)throw new InvalidOperationException(message);
    }

    private static int CheckProvisioning(string fixture) {
        SecurityIdentifier user;
        using(var identity=WindowsIdentity.GetCurrent())user=identity.User;
        var system=new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null);
        var admins=new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null);
        var everyone=new SecurityIdentifier(WellKnownSidType.WorldSid,null);
        string folder=Path.Combine(fixture,"provisioned folder");
        CapriSetup.CreateProvisionedDirectory(folder,user);
        var acl=Directory.GetAccessControl(folder,AccessControlSections.Access);
        Check(acl.AreAccessRulesProtected,"Installation ACL must not inherit unrelated parent permissions.");
        var rules=acl.GetAccessRules(true,false,typeof(SecurityIdentifier));
        Check(rules.Count==3,"Expected exactly the setup user, System and Administrators.");
        var inherited=InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit;
        foreach(FileSystemAccessRule rule in rules) {
            var sid=(SecurityIdentifier)rule.IdentityReference;
            Check(sid==user||sid==system||sid==admins,"Unexpected installation ACL principal.");
            var expected=sid==user?FileSystemRights.Modify:FileSystemRights.FullControl;
            Check(rule.AccessControlType==AccessControlType.Allow&&rule.InheritanceFlags==inherited&&
                (rule.FileSystemRights&~FileSystemRights.Synchronize)==(expected&~FileSystemRights.Synchronize),
                "Unexpected installation ACL access rights.");
        }
        string file=Path.Combine(Directory.CreateDirectory(Path.Combine(folder,"child")).FullName,"test.txt");
        File.WriteAllText(file,"first");
        File.WriteAllText(file,"updated");
        Check(File.ReadAllText(file)=="updated","The user cannot write inside the provisioned folder.");
        File.Delete(file);

        string existing=Path.Combine(fixture,"existing folder");
        Directory.CreateDirectory(existing);
        string original=Directory.GetAccessControl(existing,AccessControlSections.Access).GetSecurityDescriptorSddlForm(AccessControlSections.Access);
        CapriSetup.CreateProvisionedDirectory(existing,user);
        string current=Directory.GetAccessControl(existing,AccessControlSections.Access).GetSecurityDescriptorSddlForm(AccessControlSections.Access);
        Check(original==current,"Provisioning changed an existing folder's ACL.");

        string blocked=Path.Combine(fixture,"group target");
        foreach(var group in new[]{everyone,admins}) {
            try {
                CapriSetup.CreateProvisionedDirectory(blocked,group);
                throw new InvalidOperationException("Provisioning accepted a group in place of the setup user.");
            }catch(UnauthorizedAccessException){}
            Check(!Directory.Exists(blocked),"An invalid SID created the installation folder.");
        }
        return 0;
    }

    private static int Main(string[] args) {
        if(args[0]=="provision-fixture") {
            try {return CheckProvisioning(args[1]);}
            catch(Exception error){Console.Error.WriteLine(error);return 1;}
        }
        if(args[0]=="hold") {Thread.Sleep(12000);return 0;}
        if(args[0]=="abrupt") {
            var start=Start("hold");
            // Redirect one stream so the other inherited pipe handles reach the grandchild.
            start.RedirectStandardInput=true;
            using(Process child=Process.Start(start))File.WriteAllText(args[1],child.Id.ToString());
            return 5;
        }
        if(args[0]=="failure") {Console.Error.WriteLine("fixture startup error");return 5;}

        string uiLog=Path.Combine(args[0],"ui.jsonl");
        string pidFile=Path.Combine(args[0],"descendant.pid");
        File.WriteAllText(Path.ChangeExtension(uiLog,"worker.json"),"{\"session\":\"fixture\"}");
        var wizard=Start("abrupt \""+pidFile+"\"");
        wizard.RedirectStandardError=wizard.RedirectStandardOutput=true;
        try {
            CapriSetup.RunWizard(wizard,uiLog);
            using(Process child=Process.GetProcessById(Int32.Parse(File.ReadAllText(pidFile)))) {
                if(child.HasExited)return 2;
                child.Kill();
            }
        }catch(Exception error) {Console.Error.WriteLine(error);return 3;}

        File.Delete(Path.ChangeExtension(uiLog,"worker.json"));
        wizard=Start("failure");
        wizard.RedirectStandardError=wizard.RedirectStandardOutput=true;
        try {CapriSetup.RunWizard(wizard,uiLog);}
        catch(InvalidOperationException error) {
            if(error.Message.Contains("5 / 0x00000005") && error.Message.Contains("fixture startup error"))
                return 0;
            Console.Error.WriteLine(error);
        }
        return 4;
    }
}
