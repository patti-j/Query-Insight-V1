import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Plus, Trash2, Save, Users, Shield, ArrowLeft, RefreshCw } from 'lucide-react';
import { Link } from 'wouter';
import { ThemeToggle } from '@/components/theme-toggle';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

interface UserPermissions {
  userId: string;
  username: string;
  email?: string;
  isAdmin: boolean;
  allowedPlanningAreas: string[] | null;
  allowedScenarios: string[] | null;
  allowedPlants: string[] | null;
  allowedTableAccess: ('Sales' | 'Revenue')[] | null;
  createdAt: string;
  updatedAt: string;
}

interface FilterOptions {
  planningAreas: string[];
  scenarios: string[];
  plants: string[];
}

const TABLE_ACCESS_OPTIONS = ['Sales', 'Revenue'] as const;

export default function AdminPermissions() {
  const [users, setUsers] = useState<UserPermissions[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserPermissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ 
    planningAreas: [], 
    scenarios: [], 
    plants: [] 
  });
  const [showNewUserDialog, setShowNewUserDialog] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchUsers();
    fetchFilterOptions();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/users');
      const data = await response.json();
      setUsers(data.users || []);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to fetch users', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const fetchFilterOptions = async () => {
    try {
      const response = await fetch('/api/filter-options');
      const data = await response.json();
      const scenarioIds = (data.scenarios || []).map((s: any) => 
        typeof s === 'string' ? s : s.id
      );
      setFilterOptions({
        planningAreas: (data.planningAreas || []).filter((x: string) => x !== 'All Planning Areas'),
        scenarios: scenarioIds,
        plants: (data.plants || []).filter((x: string) => x !== 'All Plants'),
      });
    } catch (error) {
      console.error('Failed to fetch filter options:', error);
    }
  };

  const handleSelectUser = (user: UserPermissions) => {
    setSelectedUser({ ...user });
  };

  const handleCreateUser = async () => {
    if (!newUsername.trim()) {
      toast({ title: 'Error', description: 'Username is required', variant: 'destructive' });
      return;
    }

    try {
      setSaving(true);
      const response = await fetch('/api/admin/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: crypto.randomUUID(),
          username: newUsername.trim(),
          email: newEmail.trim() || undefined,
          isAdmin: newIsAdmin,
          allowedPlanningAreas: null,
          allowedScenarios: null,
          allowedPlants: null,
          allowedTableAccess: null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create user');
      }

      const data = await response.json();
      setUsers([...users, data.permissions]);
      setNewUsername('');
      setNewEmail('');
      setNewIsAdmin(false);
      setShowNewUserDialog(false);
      toast({ title: 'Success', description: 'User created successfully' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleSavePermissions = async () => {
    if (!selectedUser) return;

    try {
      setSaving(true);
      const response = await fetch(`/api/admin/permissions/${selectedUser.userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selectedUser),
      });

      if (!response.ok) {
        throw new Error('Failed to save permissions');
      }

      const data = await response.json();
      setUsers(users.map(u => u.userId === selectedUser.userId ? data.permissions : u));
      toast({ title: 'Success', description: 'Permissions saved successfully' });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to save permissions', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user?')) return;

    try {
      const response = await fetch(`/api/admin/permissions/${userId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete user');
      
      setUsers(users.filter(u => u.userId !== userId));
      if (selectedUser?.userId === userId) {
        setSelectedUser(null);
      }
      toast({ title: 'Success', description: 'User deleted successfully' });
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to delete user', variant: 'destructive' });
    }
  };

  const toggleArrayItem = (
    field: 'allowedPlanningAreas' | 'allowedScenarios' | 'allowedPlants' | 'allowedTableAccess',
    value: string
  ) => {
    if (!selectedUser) return;

    const currentArray = selectedUser[field] as string[] | null;
    let newArray: string[] | null;

    if (currentArray === null) {
      newArray = [value];
    } else if (currentArray.includes(value)) {
      newArray = currentArray.filter(v => v !== value);
      if (newArray.length === 0) newArray = null;
    } else {
      newArray = [...currentArray, value];
    }

    setSelectedUser({ ...selectedUser, [field]: newArray } as UserPermissions);
  };

  const isItemSelected = (
    field: 'allowedPlanningAreas' | 'allowedScenarios' | 'allowedPlants' | 'allowedTableAccess',
    value: string
  ): boolean => {
    if (!selectedUser) return false;
    const arr = selectedUser[field] as string[] | null;
    return arr === null || arr.includes(value);
  };

  const toggleAllAccess = (
    field: 'allowedPlanningAreas' | 'allowedScenarios' | 'allowedPlants' | 'allowedTableAccess'
  ) => {
    if (!selectedUser) return;
    const isCurrentlyAll = selectedUser[field] === null;
    setSelectedUser({ ...selectedUser, [field]: isCurrentlyAll ? [] : null });
  };

  return (
    <div className="min-h-screen bg-background" data-testid="admin-permissions-page">
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm" data-testid="link-back-home">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <Shield className="h-8 w-8" />
                User Permissions
              </h1>
              <p className="text-muted-foreground">Manage user access to planning areas, scenarios, plants, and tables</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchUsers} data-testid="button-refresh">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <ThemeToggle />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Users
                </CardTitle>
                <Dialog open={showNewUserDialog} onOpenChange={setShowNewUserDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm" data-testid="button-add-user">
                      <Plus className="h-4 w-4 mr-2" />
                      Add User
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add New User</DialogTitle>
                      <DialogDescription>
                        Create a new user with default permissions (all access).
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="username">Username</Label>
                        <Input
                          id="username"
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          placeholder="Enter username"
                          data-testid="input-new-username"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">Email (optional)</Label>
                        <Input
                          id="email"
                          type="email"
                          value={newEmail}
                          onChange={(e) => setNewEmail(e.target.value)}
                          placeholder="Enter email"
                          data-testid="input-new-email"
                        />
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="isAdmin"
                          checked={newIsAdmin}
                          onCheckedChange={(checked) => setNewIsAdmin(!!checked)}
                          data-testid="checkbox-new-admin"
                        />
                        <Label htmlFor="isAdmin">Administrator</Label>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowNewUserDialog(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleCreateUser} disabled={saving} data-testid="button-create-user">
                        {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Create User
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : users.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No users found. Add a user to get started.</p>
              ) : (
                <div className="space-y-2">
                  {users.map((user) => (
                    <div
                      key={user.userId}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedUser?.userId === user.userId
                          ? 'border-primary bg-primary/5'
                          : 'hover:bg-muted/50'
                      }`}
                      onClick={() => handleSelectUser(user)}
                      data-testid={`user-item-${user.userId}`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">{user.username}</div>
                          {user.email && <div className="text-sm text-muted-foreground">{user.email}</div>}
                        </div>
                        <div className="flex items-center gap-2">
                          {user.isAdmin && <Badge variant="secondary">Admin</Badge>}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteUser(user.userId);
                            }}
                            data-testid={`button-delete-${user.userId}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Permissions</CardTitle>
              <CardDescription>
                {selectedUser
                  ? `Editing permissions for ${selectedUser.username}`
                  : 'Select a user to edit their permissions'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedUser ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Shield className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Select a user from the list to manage their permissions</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center space-x-2 pb-4 border-b">
                    <Checkbox
                      id="adminToggle"
                      checked={selectedUser.isAdmin}
                      onCheckedChange={(checked) =>
                        setSelectedUser({ ...selectedUser, isAdmin: !!checked })
                      }
                      data-testid="checkbox-admin-toggle"
                    />
                    <Label htmlFor="adminToggle" className="font-medium">
                      Administrator (full access to all features)
                    </Label>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="font-medium">Planning Areas</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleAllAccess('allowedPlanningAreas')}
                          data-testid="button-toggle-all-planning-areas"
                        >
                          {selectedUser.allowedPlanningAreas === null ? 'Restrict' : 'Allow All'}
                        </Button>
                      </div>
                      <div className="border rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
                        {filterOptions.planningAreas.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Loading...</p>
                        ) : (
                          filterOptions.planningAreas.map((area) => (
                            <div key={area} className="flex items-center space-x-2">
                              <Checkbox
                                id={`pa-${area}`}
                                checked={isItemSelected('allowedPlanningAreas', area)}
                                onCheckedChange={() => toggleArrayItem('allowedPlanningAreas', area)}
                                disabled={selectedUser.allowedPlanningAreas === null}
                                data-testid={`checkbox-planning-area-${area}`}
                              />
                              <Label htmlFor={`pa-${area}`} className="text-sm">{area}</Label>
                            </div>
                          ))
                        )}
                      </div>
                      {selectedUser.allowedPlanningAreas === null && (
                        <p className="text-xs text-muted-foreground">All planning areas allowed</p>
                      )}
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="font-medium">Scenarios</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleAllAccess('allowedScenarios')}
                          data-testid="button-toggle-all-scenarios"
                        >
                          {selectedUser.allowedScenarios === null ? 'Restrict' : 'Allow All'}
                        </Button>
                      </div>
                      <div className="border rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
                        {filterOptions.scenarios.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Loading...</p>
                        ) : (
                          filterOptions.scenarios.map((scenario) => (
                            <div key={scenario} className="flex items-center space-x-2">
                              <Checkbox
                                id={`sc-${scenario}`}
                                checked={isItemSelected('allowedScenarios', scenario)}
                                onCheckedChange={() => toggleArrayItem('allowedScenarios', scenario)}
                                disabled={selectedUser.allowedScenarios === null}
                                data-testid={`checkbox-scenario-${scenario}`}
                              />
                              <Label htmlFor={`sc-${scenario}`} className="text-sm">{scenario}</Label>
                            </div>
                          ))
                        )}
                      </div>
                      {selectedUser.allowedScenarios === null && (
                        <p className="text-xs text-muted-foreground">All scenarios allowed</p>
                      )}
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="font-medium">Plants</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleAllAccess('allowedPlants')}
                          data-testid="button-toggle-all-plants"
                        >
                          {selectedUser.allowedPlants === null ? 'Restrict' : 'Allow All'}
                        </Button>
                      </div>
                      <div className="border rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
                        {filterOptions.plants.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Loading...</p>
                        ) : (
                          filterOptions.plants.map((plant) => (
                            <div key={plant} className="flex items-center space-x-2">
                              <Checkbox
                                id={`pl-${plant}`}
                                checked={isItemSelected('allowedPlants', plant)}
                                onCheckedChange={() => toggleArrayItem('allowedPlants', plant)}
                                disabled={selectedUser.allowedPlants === null}
                                data-testid={`checkbox-plant-${plant}`}
                              />
                              <Label htmlFor={`pl-${plant}`} className="text-sm">{plant}</Label>
                            </div>
                          ))
                        )}
                      </div>
                      {selectedUser.allowedPlants === null && (
                        <p className="text-xs text-muted-foreground">All plants allowed</p>
                      )}
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="font-medium">Table Access</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleAllAccess('allowedTableAccess')}
                          data-testid="button-toggle-all-tables"
                        >
                          {selectedUser.allowedTableAccess === null ? 'Restrict' : 'Allow All'}
                        </Button>
                      </div>
                      <div className="border rounded-lg p-3 space-y-2">
                        {TABLE_ACCESS_OPTIONS.map((table) => (
                          <div key={table} className="flex items-center space-x-2">
                            <Checkbox
                              id={`ta-${table}`}
                              checked={isItemSelected('allowedTableAccess', table)}
                              onCheckedChange={() => toggleArrayItem('allowedTableAccess', table)}
                              disabled={selectedUser.allowedTableAccess === null}
                              data-testid={`checkbox-table-${table}`}
                            />
                            <Label htmlFor={`ta-${table}`} className="text-sm">{table} Tables</Label>
                          </div>
                        ))}
                      </div>
                      {selectedUser.allowedTableAccess === null && (
                        <p className="text-xs text-muted-foreground">All tables allowed</p>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-end pt-4 border-t">
                    <Button onClick={handleSavePermissions} disabled={saving} data-testid="button-save-permissions">
                      {saving ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Save Permissions
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
