import React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const NotFound: React.FC = () => {
    return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
            <Card className="w-full max-w-md text-center">
                <CardHeader>
                    <CardTitle className="text-2xl">Page not found</CardTitle>
                    <CardDescription>
                        This link doesn&apos;t match anything in the dispatch portal. It may be
                        mistyped or out of date.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button asChild>
                        <Link to="/">Back to dispatch</Link>
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
};

export default NotFound;
